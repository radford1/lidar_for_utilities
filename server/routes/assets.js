import { Router } from 'express';

const router = Router();

// ---------------------------------------------------------------------------
// Deterministic seeded PRNG — produces consistent data per asset ID
// ---------------------------------------------------------------------------
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function seededRandom(seed) {
  let s = seed || 1;
  return function next() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ---------------------------------------------------------------------------
// GET /assets/:assetId/pole-attributes
// ---------------------------------------------------------------------------
router.get('/assets/:assetId/pole-attributes', (req, res) => {
  const assetId = req.params.assetId;
  const rng = seededRandom(hashCode(assetId));

  const materials = ['WOOD_CEDAR', 'WOOD_PINE', 'CONCRETE', 'STEEL', 'FIBERGLASS'];
  const materialWeights = [0.35, 0.30, 0.15, 0.12, 0.08];

  // Weighted material selection
  const r = rng();
  let cumulative = 0;
  let material = materials[0];
  for (let i = 0; i < materials.length; i++) {
    cumulative += materialWeights[i];
    if (r < cumulative) { material = materials[i]; break; }
  }

  const treatments = ['CCA', 'PENTA', 'CREOSOTE', 'NONE'];
  const inspectionResults = ['GOOD', 'FAIR', 'POOR', 'CRITICAL'];
  const owners = ['UTILITY', 'TELECOM', 'JOINT_USE'];

  const ageYears = Math.floor(rng() * 50) + 5; // 5-55 yrs
  const installYear = new Date().getFullYear() - ageYears;
  const installMonth = Math.floor(rng() * 12) + 1;
  const installDay = Math.floor(rng() * 28) + 1;
  const installDate = `${installYear}-${String(installMonth).padStart(2, '0')}-${String(installDay).padStart(2, '0')}`;

  const lifespanMap = { WOOD_CEDAR: 50, WOOD_PINE: 40, CONCRETE: 70, STEEL: 60, FIBERGLASS: 45 };
  const expectedLifespan = lifespanMap[material] || 50;
  const remainingLifePct = Math.max(0, Math.min(100, ((expectedLifespan - ageYears) / expectedLifespan) * 100));

  const heightFt = 35 + rng() * 15; // 35-50 ft
  const poleClass = Math.floor(rng() * 5) + 1;

  // Older poles more likely to have worse inspection results
  const inspIdx = ageYears > 40
    ? Math.min(3, Math.floor(rng() * 2) + 2)
    : ageYears > 25
      ? Math.floor(rng() * 3)
      : Math.floor(rng() * 2);
  const inspectionResult = inspectionResults[inspIdx];

  const lastInspYear = new Date().getFullYear() - Math.floor(rng() * 3);
  const lastInspMonth = Math.floor(rng() * 12) + 1;
  const lastInspectionDate = `${lastInspYear}-${String(lastInspMonth).padStart(2, '0')}-15`;

  const treatment = material.startsWith('WOOD') ? treatments[Math.floor(rng() * 3)] : 'NONE';
  const owner = pick(owners, rng);

  res.json({
    asset_id: assetId,
    pole_class: poleClass,
    material,
    height_ft: Math.round(heightFt * 10) / 10,
    install_date: installDate,
    age_years: ageYears,
    expected_lifespan_years: expectedLifespan,
    remaining_life_pct: Math.round(remainingLifePct * 10) / 10,
    last_inspection_date: lastInspectionDate,
    inspection_result: inspectionResult,
    treatment,
    owner,
  });
});

// ---------------------------------------------------------------------------
// GET /assets/:assetId/weather-stress
// ---------------------------------------------------------------------------
router.get('/assets/:assetId/weather-stress', (req, res) => {
  const assetId = req.params.assetId;
  const rng = seededRandom(hashCode(assetId + '_weather'));

  const eventTypes = [
    'THUNDERSTORM', 'ICE_STORM', 'HURRICANE', 'DERECHO',
    'TORNADO_WARNING', 'EXTREME_HEAT', 'EXTREME_COLD',
  ];

  const eventCount = Math.floor(rng() * 16) + 10; // 10-25 events
  const events = [];

  for (let i = 0; i < eventCount; i++) {
    const yearsAgo = rng() * 20;
    const d = new Date();
    d.setFullYear(d.getFullYear() - Math.floor(yearsAgo));
    d.setMonth(Math.floor(rng() * 12));
    d.setDate(Math.floor(rng() * 28) + 1);

    const eventType = pick(eventTypes, rng);
    const windSpeed = 20 + rng() * 60;
    const windGust = windSpeed + rng() * 30;
    const iceAccum = eventType === 'ICE_STORM' ? rng() * 1.5 : 0;
    const tempLow = eventType === 'EXTREME_COLD' ? -20 + rng() * 15 : 20 + rng() * 40;
    const stressScore = Math.min(100, 20 + rng() * 80);

    events.push({
      record_id: `ws_${assetId}_${i}`,
      asset_id: assetId,
      date: d.toISOString().split('T')[0],
      wind_speed_max_mph: Math.round(windSpeed * 10) / 10,
      wind_gust_mph: Math.round(windGust * 10) / 10,
      ice_accumulation_in: Math.round(iceAccum * 100) / 100,
      temperature_low_f: Math.round(tempLow),
      weather_event_type: eventType,
      stress_score: Math.round(stressScore * 10) / 10,
      cumulative_stress: 0,
      notes: '',
    });
  }

  // Sort chronologically, then compute running cumulative stress
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let cumulative = 0;
  for (const e of events) {
    cumulative += e.stress_score;
    e.cumulative_stress = Math.round(cumulative * 10) / 10;
  }

  res.json({ asset_id: assetId, events });
});

// ---------------------------------------------------------------------------
// GET /assets/:assetId/work-orders
// ---------------------------------------------------------------------------
router.get('/assets/:assetId/work-orders', (req, res) => {
  const assetId = req.params.assetId;
  const rng = seededRandom(hashCode(assetId + '_workorders'));

  const woTypes = ['INSPECTION', 'REPAIR', 'REPLACEMENT', 'VEGETATION_TRIM', 'EMERGENCY', 'UPGRADE'];
  const statuses = ['COMPLETED', 'OPEN', 'IN_PROGRESS', 'CANCELLED'];

  const descriptions = {
    INSPECTION: [
      'Annual pole inspection',
      'Detailed structural assessment',
      'Visual inspection after storm',
      'Scheduled 5-year inspection',
    ],
    REPAIR: [
      'Replaced damaged crossarm',
      'Repaired conductor attachment hardware',
      'Fixed ground wire connection',
      'Patched woodpecker damage',
    ],
    REPLACEMENT: [
      'Full pole replacement due to age',
      'Emergency pole replacement after vehicle impact',
      'Scheduled pole replacement - end of life',
    ],
    VEGETATION_TRIM: [
      'Trimmed overhanging branches within 10ft zone',
      'Removed vine growth on pole',
      'Cleared brush around pole base',
    ],
    EMERGENCY: [
      'Storm damage response - leaning pole',
      'Downed conductor reattachment',
      'Transformer fire response',
    ],
    UPGRADE: [
      'Upgraded crossarm hardware',
      'Added new conductor support',
      'Installed wildlife guard',
    ],
  };

  const count = Math.floor(rng() * 5) + 2; // 2-6 work orders
  const orders = [];

  for (let i = 0; i < count; i++) {
    const yearsAgo = rng() * 10;
    const d = new Date();
    d.setFullYear(d.getFullYear() - Math.floor(yearsAgo));
    d.setMonth(Math.floor(rng() * 12));
    d.setDate(Math.floor(rng() * 28) + 1);

    const woType = pick(woTypes, rng);
    const descList = descriptions[woType] || ['General maintenance'];
    const desc = pick(descList, rng);
    const status = yearsAgo > 1 ? 'COMPLETED' : pick(statuses, rng);

    orders.push({
      work_order_id: `WO-${assetId}-${String(i + 1).padStart(3, '0')}`,
      asset_id: assetId,
      date: d.toISOString().split('T')[0],
      work_type: woType,
      description: desc,
      status,
      crew: `Crew-${Math.floor(rng() * 20) + 1}`,
      estimated_hours: Math.round((1 + rng() * 8) * 10) / 10,
    });
  }

  // Newest first
  orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  res.json({ asset_id: assetId, work_orders: orders });
});

export default router;
