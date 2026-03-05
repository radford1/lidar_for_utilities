import { Router } from 'express';
import axios from 'axios';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const router = Router();

// ---------------------------------------------------------------------------
// Config — mirrors safety_agent.py
// ---------------------------------------------------------------------------
const LLM_ENDPOINT = 'databricks-gpt-5-2';
const SYSTEM_PROMPT =
  'You are a expert safety agent. Use lidar points around a workorder location to determine any safety hazards or special equipment needed';

const catalog = process.env.CATALOG || 'stable_classic_sdir2v_catalog';

// ---------------------------------------------------------------------------
// Databricks auth — supports PAT, OAuth M2M (service principal), and
// ~/.databrickscfg profiles.
//
// Resolution order:
//   1. PAT token   — DATABRICKS_TOKEN env var
//   2. OAuth M2M   — DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET env vars
//      (used when deployed as a Databricks App with a service principal)
//   3. Config profile — ~/.databrickscfg  (DATABRICKS_CONFIG_PROFILE, default DEFAULT)
//
// Host is resolved from DATABRICKS_SERVER_HOSTNAME / DATABRICKS_HOST or profile.
// ---------------------------------------------------------------------------

// --- OAuth M2M token cache ---
let _oauthToken = null;   // cached access_token string
let _oauthExpiry = 0;     // epoch ms when it expires (with 60s buffer)

async function getOAuthToken(host, clientId, clientSecret) {
  const now = Date.now();
  if (_oauthToken && now < _oauthExpiry) return _oauthToken;

  const url = `https://${host}/oidc/v1/token`;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await axios.post(
    url,
    'grant_type=client_credentials&scope=all-apis',
    {
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30_000,
    }
  );

  const { access_token, expires_in } = response.data;
  _oauthToken = access_token;
  // Refresh 60 seconds before actual expiry
  _oauthExpiry = now + (expires_in - 60) * 1000;
  console.log('[safety-chat] OAuth token obtained, expires in', expires_in, 's');
  return _oauthToken;
}

// --- Load static config at startup ---
function loadDatabricksConfig() {
  const envHost = (process.env.DATABRICKS_SERVER_HOSTNAME || process.env.DATABRICKS_HOST || '')
    .replace(/^https?:\/\//, '').replace(/\/+$/, '') || null;
  const envToken = process.env.DATABRICKS_TOKEN || null;
  const envClientId = process.env.DATABRICKS_CLIENT_ID || null;
  const envClientSecret = process.env.DATABRICKS_CLIENT_SECRET || null;

  // If we have a PAT or OAuth creds with a host, we're done
  if (envHost && (envToken || (envClientId && envClientSecret))) {
    const authType = envToken ? 'pat' : 'oauth-m2m';
    return { host: envHost, token: envToken, clientId: envClientId, clientSecret: envClientSecret, authType };
  }

  // Fall back to ~/.databrickscfg profile
  const profileName = process.env.DATABRICKS_CONFIG_PROFILE || 'DEFAULT';
  const cfgPath = join(homedir(), '.databrickscfg');
  let host = envHost;
  let token = envToken;
  let clientId = envClientId;
  let clientSecret = envClientSecret;

  try {
    const cfgText = readFileSync(cfgPath, 'utf-8');
    let inProfile = false;

    for (const raw of cfgText.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[')) {
        const name = line.replace(/^\[/, '').replace(/\]$/, '').trim();
        inProfile = name.toUpperCase() === profileName.toUpperCase();
        continue;
      }
      if (!inProfile) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.substring(0, eqIdx).trim().toLowerCase();
      const value = line.substring(eqIdx + 1).trim();
      if (key === 'host' && !host) host = value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      if (key === 'token' && !token) token = value;
      if (key === 'client_id' && !clientId) clientId = value;
      if (key === 'client_secret' && !clientSecret) clientSecret = value;
    }
  } catch { /* no config file — that's fine */ }

  const authType = token ? 'pat' : (clientId && clientSecret) ? 'oauth-m2m' : 'none';
  return { host, token, clientId, clientSecret, authType };
}

const _dbConfig = loadDatabricksConfig();

// Resolve a Bearer token — either the static PAT or a refreshed OAuth token
async function getBearerToken() {
  if (_dbConfig.authType === 'pat') return _dbConfig.token;
  if (_dbConfig.authType === 'oauth-m2m') {
    return getOAuthToken(_dbConfig.host, _dbConfig.clientId, _dbConfig.clientSecret);
  }
  return null;
}

console.log('[safety-chat] Databricks config:', {
  host: _dbConfig.host ? '***' + _dbConfig.host.slice(-20) : null,
  authType: _dbConfig.authType,
});

// ---------------------------------------------------------------------------
// Tool definition (OpenAI function-calling format)
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_points_around_latlng',
      description:
        'Retrieve LiDAR point cloud data around a given latitude/longitude. Returns nearby 3-D points with x, y, z coordinates and distance in meters.',
      parameters: {
        type: 'object',
        properties: {
          input_lat: { type: 'number', description: 'Latitude of the work-order location' },
          input_lng: { type: 'number', description: 'Longitude of the work-order location' },
        },
        required: ['input_lat', 'input_lng'],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution — calls the UC SQL function via the existing DB connection
// ---------------------------------------------------------------------------
async function executeGetPoints(db, lat, lng) {
  const sql = `SELECT * FROM ${catalog}.gold_lidar.get_points_around_latlng(${lat}, ${lng})`;
  console.log('[safety-chat] executing tool SQL:', sql.substring(0, 120));
  const rows = await db.query(sql);
  return {
    is_truncated: rows.length >= 200,
    columns: ['x', 'y', 'z', 'distance_meters', 'classification'],
    rows: rows.map((r) => [r.x, r.y, r.z, r.distance_meters, r.classification]),
  };
}

// ---------------------------------------------------------------------------
// Streaming LLM call — returns a readable stream of SSE chunks
// ---------------------------------------------------------------------------
async function callLLMStream(host, messages) {
  const token = await getBearerToken();
  const url = `https://${host}/serving-endpoints/${LLM_ENDPOINT}/invocations`;
  const response = await axios.post(
    url,
    { messages, tools: TOOLS, stream: true },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
      responseType: 'stream',
    }
  );
  return response.data; // Node readable stream
}

// ---------------------------------------------------------------------------
// Non-streaming LLM call (used for tool-call iterations)
// ---------------------------------------------------------------------------
async function callLLM(host, messages) {
  const token = await getBearerToken();
  const url = `https://${host}/serving-endpoints/${LLM_ENDPOINT}/invocations`;
  const response = await axios.post(
    url,
    { messages, tools: TOOLS },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 120_000,
    }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Parse SSE lines from a raw text buffer, returning parsed data objects
// ---------------------------------------------------------------------------
function parseSSELines(text) {
  const events = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '[DONE]') {
      events.push({ done: true });
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      // partial JSON — will be completed in next chunk
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// POST /api/safety-chat — agentic tool-calling loop with streaming final
// ---------------------------------------------------------------------------
router.post('/safety-chat', async (req, res) => {
  try {
    const { lat, lng, messages: clientMessages, sessionId } = req.body || {};

    const db = req.app.get('db');
    const { host, authType } = _dbConfig;

    if (!host) return res.status(500).json({ error: 'Databricks host not configured (set DATABRICKS_SERVER_HOSTNAME or use a config profile)' });
    if (authType === 'none') return res.status(500).json({ error: 'Databricks auth not configured (set DATABRICKS_TOKEN, or DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET, or use a config profile)' });

    // Build message list starting with system prompt
    const llmMessages = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (Array.isArray(clientMessages) && clientMessages.length > 0) {
      for (const m of clientMessages) {
        if (m && typeof m.role === 'string' && typeof m.content === 'string') {
          llmMessages.push({ role: m.role, content: m.content });
        }
      }
    } else if (
      typeof lat === 'number' && Number.isFinite(lat) &&
      typeof lng === 'number' && Number.isFinite(lng)
    ) {
      llmMessages.push({ role: 'user', content: `Lat/Long: ${lat}, ${lng}` });
    } else {
      return res.status(400).json({ error: 'Provide either lat/lng numbers or a messages array' });
    }

    const sid = sessionId || `safety-${Date.now()}`;
    const MAX_ITERATIONS = 10;

    console.log('[safety-chat] starting agent loop', { messageCount: llmMessages.length, sessionId: sid });

    // --- Tool-calling loop (non-streaming) ---
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const llmResponse = await callLLM(host, llmMessages);
      const choice = llmResponse.choices?.[0];

      if (!choice) {
        return res.json({ reply: 'No response from LLM.', sessionId: sid });
      }

      const assistantMsg = choice.message;
      llmMessages.push(assistantMsg);

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        // Execute tool calls
        for (const toolCall of assistantMsg.tool_calls) {
          const fnName = toolCall.function?.name;
          const args = JSON.parse(toolCall.function?.arguments || '{}');
          let result;

          console.log(`[safety-chat] tool call: ${fnName}`, args);

          try {
            if (fnName === 'get_points_around_latlng') {
              const data = await executeGetPoints(db, args.input_lat, args.input_lng);
              result = JSON.stringify(data);
            } else {
              result = JSON.stringify({ error: `Unknown tool: ${fnName}` });
            }
          } catch (toolErr) {
            console.error(`[safety-chat] tool error (${fnName}):`, toolErr.message);
            result = JSON.stringify({ error: toolErr.message });
          }

          llmMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }
        continue; // loop back for next LLM call
      }

      // No tool calls — this was the final response (non-streaming path)
      // We got here on a non-streaming call.  Break out and re-do this
      // last turn as a streaming call so the client gets token-by-token.
      // Remove the assistant message we just pushed (we'll re-generate it streaming).
      llmMessages.pop();
      break;
    }

    // --- Final response: streaming ---
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sid);
    res.flushHeaders();

    console.log('[safety-chat] streaming final response');

    const stream = await callLLMStream(host, llmMessages);

    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();

      // Process complete lines
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();

        if (payload === '[DONE]') {
          res.write('data: [DONE]\n\n');
          continue;
        }

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
          }
        } catch {
          // incomplete JSON, skip
        }
      }
    });

    stream.on('end', () => {
      // Process any remaining buffer
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload !== '[DONE]') {
            try {
              const parsed = JSON.parse(payload);
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) {
                res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
              }
            } catch { /* ignore */ }
          }
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
      console.log('[safety-chat] stream complete');
    });

    stream.on('error', (err) => {
      console.error('[safety-chat] stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || { error: err.message };
    console.error('[safety-chat] error', status, typeof detail === 'string' ? detail : JSON.stringify(detail).substring(0, 500));

    // If headers haven't been sent yet, respond with JSON error
    if (!res.headersSent) {
      return res.status(status).json({ error: 'Safety agent request failed', detail });
    }
    // Otherwise we're already in SSE mode
    res.write(`data: ${JSON.stringify({ error: 'Safety agent request failed' })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

export default router;
