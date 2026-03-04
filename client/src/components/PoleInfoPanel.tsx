import React, { useEffect, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PoleAttributes {
  asset_id: string;
  pole_class: number;
  material: string;
  height_ft: number;
  install_date: string;
  age_years: number;
  expected_lifespan_years: number;
  remaining_life_pct: number;
  last_inspection_date: string;
  inspection_result: string;
  treatment: string;
  owner: string;
}

interface WeatherEvent {
  record_id: string;
  date: string;
  wind_speed_max_mph: number;
  wind_gust_mph: number;
  ice_accumulation_in: number;
  temperature_low_f: number;
  weather_event_type: string;
  stress_score: number;
  cumulative_stress: number;
}

interface WorkOrder {
  work_order_id: string;
  date: string;
  work_type: string;
  description: string;
  status: string;
  crew: string;
  estimated_hours: number;
}

interface ForecastPoint {
  timestamp: string;
  offset_minutes: number;
  mw: number;
}

interface Props {
  poleId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const materialLabel: Record<string, string> = {
  WOOD_CEDAR: 'Cedar',
  WOOD_PINE: 'Pine',
  CONCRETE: 'Concrete',
  STEEL: 'Steel',
  FIBERGLASS: 'Fiberglass',
};
const materialColor: Record<string, string> = {
  WOOD_CEDAR: '#8B5E3C',
  WOOD_PINE: '#C4A35A',
  CONCRETE: '#9CA3AF',
  STEEL: '#6B7280',
  FIBERGLASS: '#60A5FA',
};

const weatherIcon: Record<string, string> = {
  THUNDERSTORM: '\u26C8\uFE0F',
  ICE_STORM: '\u2744\uFE0F',
  HURRICANE: '\uD83C\uDF00',
  DERECHO: '\uD83D\uDCA8',
  TORNADO_WARNING: '\uD83C\uDF2A\uFE0F',
  EXTREME_HEAT: '\u2600\uFE0F',
  EXTREME_COLD: '\uD83E\uDD76',
};

const weatherLabel: Record<string, string> = {
  THUNDERSTORM: 'Thunderstorm',
  ICE_STORM: 'Ice Storm',
  HURRICANE: 'Hurricane',
  DERECHO: 'Derecho',
  TORNADO_WARNING: 'Tornado Warning',
  EXTREME_HEAT: 'Extreme Heat',
  EXTREME_COLD: 'Extreme Cold',
};

const stressColor = (score: number) => {
  if (score < 25) return '#22c55e';
  if (score < 50) return '#eab308';
  if (score < 75) return '#f97316';
  return '#ef4444';
};

const inspectionColor: Record<string, string> = {
  GOOD: '#22c55e',
  FAIR: '#eab308',
  POOR: '#f97316',
  CRITICAL: '#ef4444',
};

const statusColor: Record<string, string> = {
  COMPLETED: '#22c55e',
  OPEN: '#3b82f6',
  IN_PROGRESS: '#f59e0b',
  CANCELLED: '#6b7280',
};

const woTypeLabel: Record<string, string> = {
  INSPECTION: 'Inspection',
  REPAIR: 'Repair',
  REPLACEMENT: 'Replacement',
  VEGETATION_TRIM: 'Veg Trim',
  EMERGENCY: 'Emergency',
  UPGRADE: 'Upgrade',
};

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PoleInfoPanel({ poleId, onClose }: Props) {
  const [attributes, setAttributes] = useState<PoleAttributes | null>(null);
  const [weatherEvents, setWeatherEvents] = useState<WeatherEvent[] | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[] | null>(null);
  const [loadForecast, setLoadForecast] = useState<ForecastPoint[] | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'weather' | 'workorders' | 'forecast'>('info');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoaded, setDetailLoaded] = useState(false);

  // Fetch basic attributes whenever the selected pole changes
  useEffect(() => {
    setLoading(true);
    setAttributes(null);
    setWeatherEvents(null);
    setWorkOrders(null);
    setLoadForecast(null);
    setActiveTab('info');
    setDetailLoaded(false);

    fetch(`/api/assets/${encodeURIComponent(poleId)}/pole-attributes`)
      .then((r) => r.json())
      .then((data) => {
        setAttributes(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [poleId]);

  const loadDetails = () => {
    if (detailLoaded || detailLoading) return;
    setDetailLoading(true);
    Promise.all([
      fetch(`/api/assets/${encodeURIComponent(poleId)}/weather-stress`).then((r) => r.json()),
      fetch(`/api/assets/${encodeURIComponent(poleId)}/work-orders`).then((r) => r.json()),
      fetch(`/api/assets/${encodeURIComponent(poleId)}/load-forecast`).then((r) => r.json()),
    ])
      .then(([weather, orders, forecast]) => {
        setWeatherEvents(weather.events || []);
        setWorkOrders(orders.work_orders || []);
        setLoadForecast(forecast.forecast || []);
        setDetailLoaded(true);
        setActiveTab('forecast');
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  };

  // --- Styles (dark theme to match the 3D modal) ---
  const panel: React.CSSProperties = {
    height: '100%',
    background: 'rgba(15, 23, 42, 0.96)',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid rgba(148, 163, 184, 0.25)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    overflow: 'hidden',
  };

  const header: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
    flexShrink: 0,
  };

  const body: React.CSSProperties = {
    flex: '1 1 auto',
    overflow: 'auto',
    padding: '12px 14px',
  };

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
  };

  const label: React.CSSProperties = { opacity: 0.7, fontSize: 12 };
  const value: React.CSSProperties = { fontWeight: 600 };

  const tabBar: React.CSSProperties = {
    display: 'flex',
    gap: 0,
    borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
    flexShrink: 0,
  };

  const tabBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
    color: active ? '#e2e8f0' : '#94a3b8',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
  });

  const lifePctColor = (pct: number) => {
    if (pct > 60) return '#22c55e';
    if (pct > 30) return '#eab308';
    return '#ef4444';
  };

  // --- Render ---
  return (
    <div style={panel}>
      {/* Header */}
      <div style={header}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          Pole {poleId}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: '1px solid rgba(148,163,184,0.3)',
            color: '#e2e8f0',
            borderRadius: 4,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          &times;
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ ...body, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
          Loading...
        </div>
      )}

      {/* Tabs (only show after detail data is loaded) */}
      {!loading && detailLoaded && (
        <div style={tabBar}>
          <button style={tabBtn(activeTab === 'info')} onClick={() => setActiveTab('info')}>
            Info
          </button>
          <button style={tabBtn(activeTab === 'forecast')} onClick={() => setActiveTab('forecast')}>
            Forecast
          </button>
          <button style={tabBtn(activeTab === 'weather')} onClick={() => setActiveTab('weather')}>
            Weather
          </button>
          <button style={tabBtn(activeTab === 'workorders')} onClick={() => setActiveTab('workorders')}>
            Work Orders
          </button>
        </div>
      )}

      {/* Body */}
      {!loading && attributes && (
        <div style={body}>
          {/* ---- INFO TAB ---- */}
          {activeTab === 'info' && (
            <>
              {/* Material */}
              <div style={row}>
                <span style={label}>Material</span>
                <span style={{ ...value, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: materialColor[attributes.material] || '#9CA3AF',
                    }}
                  />
                  {materialLabel[attributes.material] || attributes.material}
                </span>
              </div>

              {/* Height */}
              <div style={row}>
                <span style={label}>Height</span>
                <span style={value}>
                  {attributes.height_ft} ft ({(attributes.height_ft * 0.3048).toFixed(1)} m)
                </span>
              </div>

              {/* Pole Class */}
              <div style={row}>
                <span style={label}>Pole Class</span>
                <span style={value}>{attributes.pole_class}</span>
              </div>

              {/* Age */}
              <div style={row}>
                <span style={label}>Age</span>
                <span style={value}>
                  {attributes.age_years} yrs (installed {formatDate(attributes.install_date)})
                </span>
              </div>

              {/* Owner */}
              <div style={row}>
                <span style={label}>Owner</span>
                <span style={value}>{attributes.owner}</span>
              </div>

              {/* Treatment */}
              {attributes.treatment !== 'NONE' && (
                <div style={row}>
                  <span style={label}>Treatment</span>
                  <span style={value}>{attributes.treatment}</span>
                </div>
              )}

              {/* Remaining Life */}
              <div style={{ marginTop: 12 }}>
                <div style={{ ...label, marginBottom: 4 }}>Remaining Life</div>
                <div
                  style={{
                    height: 8,
                    background: 'rgba(148,163,184,0.2)',
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(0, Math.min(100, attributes.remaining_life_pct))}%`,
                      height: '100%',
                      background: lifePctColor(attributes.remaining_life_pct),
                      borderRadius: 4,
                      transition: 'width 0.3s',
                    }}
                  />
                </div>
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                  {attributes.remaining_life_pct.toFixed(0)}% — expected lifespan{' '}
                  {attributes.expected_lifespan_years} yrs
                </div>
              </div>

              {/* Inspection */}
              <div style={{ marginTop: 14 }}>
                <div style={row}>
                  <span style={label}>Last Inspection</span>
                  <span style={value}>{formatDate(attributes.last_inspection_date)}</span>
                </div>
                <div style={row}>
                  <span style={label}>Result</span>
                  <span
                    style={{
                      ...value,
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 11,
                      background: inspectionColor[attributes.inspection_result] || '#6b7280',
                      color: '#fff',
                    }}
                  >
                    {attributes.inspection_result}
                  </span>
                </div>
              </div>

              {/* View Details button */}
              <button
                onClick={loadDetails}
                disabled={detailLoading}
                style={{
                  marginTop: 18,
                  width: '100%',
                  padding: '10px 0',
                  borderRadius: 6,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: detailLoading ? 'not-allowed' : 'pointer',
                  opacity: detailLoading ? 0.7 : 1,
                }}
              >
                {detailLoading ? 'Loading Details...' : detailLoaded ? 'Details Loaded' : 'View Details'}
              </button>
            </>
          )}

          {/* ---- WEATHER TAB ---- */}
          {activeTab === 'weather' && weatherEvents && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
                Weather Stress History
              </div>
              {weatherEvents.length === 0 && (
                <div style={{ opacity: 0.5, fontSize: 12 }}>No weather events recorded.</div>
              )}
              {/* Show events newest first */}
              {[...weatherEvents].reverse().map((ev) => (
                <div
                  key={ev.record_id}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid rgba(148,163,184,0.12)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 16 }}>{weatherIcon[ev.weather_event_type] || '\u26A0\uFE0F'}</span>
                    <span style={{ fontWeight: 600 }}>
                      {weatherLabel[ev.weather_event_type] || ev.weather_event_type}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>
                      {formatDate(ev.date)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, opacity: 0.8, marginBottom: 4 }}>
                    <span>Wind: {ev.wind_speed_max_mph} mph</span>
                    <span>Gust: {ev.wind_gust_mph} mph</span>
                    {ev.ice_accumulation_in > 0 && <span>Ice: {ev.ice_accumulation_in} in</span>}
                    {ev.weather_event_type === 'EXTREME_COLD' && (
                      <span>Low: {ev.temperature_low_f}&deg;F</span>
                    )}
                  </div>
                  {/* Stress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        background: 'rgba(148,163,184,0.15)',
                        borderRadius: 3,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${ev.stress_score}%`,
                          height: '100%',
                          background: stressColor(ev.stress_score),
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>
                      {ev.stress_score}/100
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ---- LOAD FORECAST TAB ---- */}
          {activeTab === 'forecast' && loadForecast && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
                Load Forecast — Next 8 Hours
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 12 }}>
                Total MW delivered through this pole's feeder segment
              </div>

              {(() => {
                const pts = loadForecast;
                if (!pts.length) return <div style={{ opacity: 0.5, fontSize: 12 }}>No forecast data.</div>;

                const mwValues = pts.map((p) => p.mw);
                const minMW = Math.min(...mwValues);
                const maxMW = Math.max(...mwValues);
                const rangeMW = maxMW - minMW || 1;
                const avgMW = mwValues.reduce((s, v) => s + v, 0) / mwValues.length;
                const peakMW = maxMW;
                const peakIdx = mwValues.indexOf(peakMW);

                // Chart dimensions
                const W = 310;
                const H = 160;
                const padL = 40;
                const padR = 10;
                const padT = 10;
                const padB = 28;
                const cw = W - padL - padR;
                const ch = H - padT - padB;

                // Scale with 5% breathing room
                const yMin = minMW - rangeMW * 0.05;
                const yMax = maxMW + rangeMW * 0.05;
                const yRange = yMax - yMin;

                const toX = (i: number) => padL + (i / (pts.length - 1)) * cw;
                const toY = (mw: number) => padT + ch - ((mw - yMin) / yRange) * ch;

                // Build SVG polyline points
                const linePoints = pts.map((p, i) => `${toX(i)},${toY(p.mw)}`).join(' ');
                // Area fill (close polygon along bottom)
                const areaPath =
                  `M${toX(0)},${toY(pts[0].mw)} ` +
                  pts.map((p, i) => `L${toX(i)},${toY(p.mw)}`).join(' ') +
                  ` L${toX(pts.length - 1)},${padT + ch} L${toX(0)},${padT + ch} Z`;

                // Y-axis tick values (4 ticks)
                const yTicks: number[] = [];
                for (let t = 0; t <= 3; t++) {
                  yTicks.push(yMin + (yRange * t) / 3);
                }

                // X-axis labels — show hours from now: 0h, 2h, 4h, 6h, 8h
                const xLabels = [0, 2, 4, 6, 8].map((h) => ({
                  label: `+${h}h`,
                  x: toX((h / 8) * (pts.length - 1)),
                }));

                // Format time for tooltip-style info
                const formatTime = (iso: string) => {
                  const d = new Date(iso);
                  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                };

                return (
                  <div>
                    <svg width={W} height={H} style={{ display: 'block', margin: '0 auto' }}>
                      {/* Grid lines */}
                      {yTicks.map((v, i) => (
                        <g key={i}>
                          <line
                            x1={padL}
                            x2={W - padR}
                            y1={toY(v)}
                            y2={toY(v)}
                            stroke="rgba(148,163,184,0.15)"
                            strokeDasharray="3,3"
                          />
                          <text
                            x={padL - 4}
                            y={toY(v) + 3}
                            textAnchor="end"
                            fill="#94a3b8"
                            fontSize={10}
                          >
                            {v.toFixed(2)}
                          </text>
                        </g>
                      ))}

                      {/* X-axis labels */}
                      {xLabels.map((xl, i) => (
                        <text
                          key={i}
                          x={xl.x}
                          y={H - 4}
                          textAnchor="middle"
                          fill="#94a3b8"
                          fontSize={10}
                        >
                          {xl.label}
                        </text>
                      ))}

                      {/* Gradient fill under line */}
                      <defs>
                        <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <path d={areaPath} fill="url(#forecastGrad)" />

                      {/* Line */}
                      <polyline
                        points={linePoints}
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />

                      {/* Peak marker */}
                      <circle cx={toX(peakIdx)} cy={toY(peakMW)} r={3.5} fill="#ef4444" />
                      <text
                        x={toX(peakIdx)}
                        y={toY(peakMW) - 7}
                        textAnchor="middle"
                        fill="#ef4444"
                        fontSize={9}
                        fontWeight={600}
                      >
                        {peakMW.toFixed(2)}
                      </text>

                      {/* Current (first) marker */}
                      <circle cx={toX(0)} cy={toY(pts[0].mw)} r={3} fill="#22c55e" />
                    </svg>

                    {/* Summary stats below chart */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: 8,
                        marginTop: 12,
                        textAlign: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>Current</div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#22c55e' }}>
                          {pts[0].mw.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.5 }}>MW</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>Avg</div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#3b82f6' }}>
                          {avgMW.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.5 }}>MW</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>Peak</div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#ef4444' }}>
                          {peakMW.toFixed(2)}
                        </div>
                        <div style={{ fontSize: 10, opacity: 0.5 }}>
                          MW @ {formatTime(pts[peakIdx].timestamp)}
                        </div>
                      </div>
                    </div>

                    {/* Time range */}
                    <div
                      style={{
                        marginTop: 14,
                        padding: '8px 10px',
                        background: 'rgba(148,163,184,0.08)',
                        borderRadius: 6,
                        fontSize: 11,
                        display: 'flex',
                        justifyContent: 'space-between',
                        opacity: 0.7,
                      }}
                    >
                      <span>From: {formatTime(pts[0].timestamp)}</span>
                      <span>To: {formatTime(pts[pts.length - 1].timestamp)}</span>
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* ---- WORK ORDERS TAB ---- */}
          {activeTab === 'workorders' && workOrders && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14 }}>
                Work Order History
              </div>
              {workOrders.length === 0 && (
                <div style={{ opacity: 0.5, fontSize: 12 }}>No work orders recorded.</div>
              )}
              {workOrders.map((wo) => (
                <div
                  key={wo.work_order_id}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid rgba(148,163,184,0.12)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>
                      {woTypeLabel[wo.work_type] || wo.work_type}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: statusColor[wo.status] || '#6b7280',
                        color: '#fff',
                        fontWeight: 600,
                      }}
                    >
                      {wo.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 3 }}>{wo.description}</div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, opacity: 0.6 }}>
                    <span>{formatDate(wo.date)}</span>
                    <span>{wo.crew}</span>
                    <span>{wo.estimated_hours} hrs</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
