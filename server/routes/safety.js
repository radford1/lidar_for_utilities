import { Router } from 'express';
import axios from 'axios';

const router = Router();

// ---------------------------------------------------------------------------
// Config — mirrors safety_agent.py
// ---------------------------------------------------------------------------
const LLM_ENDPOINT = 'databricks-gpt-5-2';
const SYSTEM_PROMPT =
  'You are a expert safety agent. Use lidar points around a workorder location to determine any safety hazards or special equipment needed';

const catalog = process.env.CATALOG || 'stable_classic_sdir2v_catalog';

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
async function callLLMStream(host, token, messages) {
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
async function callLLM(host, token, messages) {
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
    const host = process.env.DATABRICKS_SERVER_HOSTNAME || process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;

    if (!host) return res.status(500).json({ error: 'DATABRICKS_SERVER_HOSTNAME is not configured' });
    if (!token) return res.status(500).json({ error: 'DATABRICKS_TOKEN is not configured' });

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
      const llmResponse = await callLLM(host, token, llmMessages);
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

    const stream = await callLLMStream(host, token, llmMessages);

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
