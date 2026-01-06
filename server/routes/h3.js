import { Router } from 'express';
import axios from 'axios';

const router = Router();
const catalog = process.env.CATALOG;

// Runtime config so client doesn't bundle secrets
router.get('/config', (req, res) => {
  const mapboxToken =
    process.env.MAPBOX_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_PUBLIC_TOKEN ||
    '';
  res.json({ mapboxToken });
});

function parseBbox(bboxStr) {
  if (!bboxStr) return null;
  const parts = bboxStr.split(',').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  const [minLon, minLat, maxLon, maxLat] = parts;
  return { minLon, minLat, maxLon, maxLat };
}

router.get('/h3', async (req, res) => {
  const db = req.db;
  const bbox = parseBbox(req.query.bbox);

  let where = '';
  if (bbox) {
    const { minLon, minLat, maxLon, maxLat } = bbox;
    where = `WHERE longitude BETWEEN ${minLon} AND ${maxLon} AND latitude BETWEEN ${minLat} AND ${maxLat}`;
  }

//   const sql = `
// SELECT h3_10,
//        max(CASE WHEN is_encroaching THEN 1 ELSE 0 END) AS has_encroaching
// FROM david_radford.geospatial.lidar_points_encroachment
// ${where}
// GROUP BY h3_10
// `;

  const sql = `
  SELECT A.h3_10,
         max(CASE WHEN A.is_encroaching THEN 1 ELSE 0 END) AS has_encroaching,
         max(B.fire_risk) AS fire_risk,
         max(C.veg_index) AS veg_index,
         st_x(st_geomfromgeojson(h3_centerasgeojson(A.h3_10))) as lng,
         st_y(st_geomfromgeojson(h3_centerasgeojson(A.h3_10))) as lat
  FROM ${catalog}.gold_lidar.dense_encroachment A
  JOIN ${catalog}.bronze_lidar.fire_risk B USING(h3_10)
  JOIN ${catalog}.bronze_lidar.veg_index C USING(h3_10)
  GROUP BY A.h3_10
  `;

 

  try {
    const rows = await db.query(sql);
    const all = rows.map((r) => r.h3_10);
    const enc = rows.filter((r) => Number(r.has_encroaching) > 0).map((r) => r.h3_10);
    const fireRisk = Object.fromEntries(rows
      .filter((r) => r.fire_risk !== undefined && r.fire_risk !== null)
      .map((r) => [r.h3_10, Number(r.fire_risk)])
    );
    const vegIndex = Object.fromEntries(rows
      .filter((r) => r.veg_index !== undefined && r.veg_index !== null)
      .map((r) => [r.h3_10, Number(r.veg_index)])
    );
    const centroids = Object.fromEntries(rows
      .filter((r) => r.lat !== undefined && r.lng !== undefined && r.lat !== null && r.lng !== null)
      .map((r) => [r.h3_10, [Number(r.lat), Number(r.lng)]])
    );
    res.json({ count: all.length, h3: all, encroaching: enc, fireRisk, vegIndex, centroids });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function isHex(str) {
  return /^[0-9a-fA-F]+$/.test(str);
}

router.get('/h3/:h3Hex/points', async (req, res) => {
  const db = req.db;
  const h3Hex = String(req.params.h3Hex || '').trim();
  if (!isHex(h3Hex)) {
    return res.status(400).json({ error: 'Invalid h3Hex' });
  }
//   const sql = `
// SELECT x, y, z, classification, latitude as lat, longitude as lng
// FROM david_radford.geospatial.lidar_points_h3
// WHERE h3_10 = lower('${h3Hex}')
// // `;
  // const sql = `
  // SELECT x, y, z, classification, lat, lng, is_encroaching
  // FROM david_radford.geospatial.lidar_points_encroachment
  // WHERE h3_10 = lower('${h3Hex}')
  // `;
  const sql = `
  SELECT x, y, z, classification, lat, lng, case when is_encroaching is null then false else is_encroaching end as is_encroaching
  FROM ${catalog}.gold_lidar.dense_encroachment
  WHERE h3_10 = lower('${h3Hex}')
  `;


  try {
    const rows = await db.query(sql);
    res.json({ h3Hex, count: rows.length, points: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/h3/:h3Hex/poles', async (req, res) => {
  const db = req.db;
  const h3Hex = String(req.params.h3Hex || '').trim();
  if (!isHex(h3Hex)) {
    return res.status(400).json({ error: 'Invalid h3Hex' });
  }

  const sql = `
SELECT pole_id, lat, lng, height_m, connects_to, line_sag
FROM ${catalog}.bronze_lidar.line_topology
WHERE h3_10 = lower('${h3Hex}')
`;

  try {
    const rows = await db.query(sql);
    res.json({ h3Hex, count: rows.length, poles: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.post('/workorders', async (req, res) => {
  try {
    const db = req.db;
    const { h3Hex, fireRisk, vegIndex, encroachment, note } = req.body || {};
    const hex = String(h3Hex || '').trim();
    if (!hex || !isHex(hex)) {
      return res.status(400).json({ error: 'Invalid or missing h3Hex' });
    }
    const id = `wo_${Date.now()}`;
    const risk = Number.isFinite(Number(fireRisk)) ? Number(fireRisk) : null;
    const veg = Number.isFinite(Number(vegIndex)) ? Number(vegIndex) : null;
    const enc = Boolean(encroachment);
    const esc = (s) => String(s).replace(/'/g, "''");
    const noteVal = (note === undefined || note === null || note === '') ? null : esc(note);
    const sql = `
INSERT INTO david_radford.smud_geospatial.workorders (id, h3_10, fire_risk, veg_index, encroachment, note)
VALUES ('${esc(id)}', lower('${esc(hex)}'), ${risk === null ? 'NULL' : risk}, ${veg === null ? 'NULL' : veg}, ${enc ? 'true' : 'false'}, ${noteVal === null ? 'NULL' : `'${noteVal}'`})
`;
    await db.execute(sql);
    return res.status(201).json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const { messages, message, conversationId, userId } = req.body || {};

    const hasMessages = Array.isArray(messages) && messages.length > 0;
    const hasMessage = typeof message === 'string' && message.length > 0;
    if (!hasMessages && !hasMessage) {
      return res.status(400).json({ error: 'Missing required field: message or messages' });
    }

    const servingEndpoint = process.env.DATABRICKS_SERVING_ENDPOINT || 'mas-f9a77ad0-endpoint';
    const host = process.env.DATABRICKS_SERVER_HOSTNAME || process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;

    if (!host) {
      return res.status(500).json({ error: 'DATABRICKS_SERVER_HOSTNAME is not configured' });
    }
    if (!token) {
      return res.status(500).json({ error: 'DATABRICKS_TOKEN is not configured' });
    }

    const url = `https://${host}/serving-endpoints/${servingEndpoint}/invocations`;
    console.log('[chat] → Databricks', {
      url,
      host,
      servingEndpoint,
      hasToken: Boolean(token),
      hasMessage: hasMessage,
      hasMessages: hasMessages,
      conversationId: conversationId || null
    });

    const normalizedMessages = hasMessages
      ? messages
          .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
          .map(m => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: message }];

    const payload = {
      input: normalizedMessages,
      databricks_options: {
        conversation_id: conversationId || undefined,
        return_trace: true,
      },
      context: {
        conversation_id: conversationId || undefined,
        user_id: userId || 'anonymous',
      },
    };

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const response = await axios.post(url, payload, { headers });
    console.log('[chat] ← Databricks status', response.status);
    const data = response && response.data !== undefined ? response.data : {};

    // Try to extract a human-readable reply string from common response shapes
    const extractReply = (body) => {
      if (!body) return '';
      if (typeof body === 'string') return body;
      if (body.reply && typeof body.reply === 'string') return body.reply;
      // Databricks Responses API shape
      if (body.object === 'response' && Array.isArray(body.output)) {
        const firstMessage = body.output.find((o) => o && o.type === 'message' && Array.isArray(o.content));
        if (firstMessage) {
          const pieces = firstMessage.content
            .filter((c) => c && typeof c.text === 'string')
            .map((c) => c.text.trim())
            .filter(Boolean);
          if (pieces.length) return pieces.join(' ');
        }
        // Some variants may include a root-level text
        if (typeof body.text === 'string' && body.text.trim()) return body.text.trim();
      }
      if (Array.isArray(body.predictions)) {
        const first = body.predictions[0];
        if (typeof first === 'string') return first;
        if (first && typeof first.text === 'string') return first.text;
        if (first && Array.isArray(first.candidates) && first.candidates[0]) {
          const cand = first.candidates[0];
          if (typeof cand === 'string') return cand;
          if (typeof cand.text === 'string') return cand.text;
          if (cand.message && typeof cand.message.content === 'string') return cand.message.content;
        }
      }
      if (Array.isArray(body.choices) && body.choices[0]) {
        const c = body.choices[0];
        if (typeof c.text === 'string') return c.text;
        if (c.message && typeof c.message.content === 'string') return c.message.content;
      }
      if (typeof body.output === 'string') return body.output;
      if (typeof body.output_text === 'string') return body.output_text;
      if (body.result && typeof body.result === 'string') return body.result;
      return JSON.stringify(body);
    };

    const reply = extractReply(data);

    return res.json({ reply, conversationId: conversationId || null, raw: data });
  } catch (err) {
    const status = err.response?.status || 500;
    const detail = err.response?.data || { error: err.message };
    console.error('[chat] Databricks error', status, detail);
    return res.status(status).json({ error: 'Databricks request failed', detail });
  }
});

export default router;


