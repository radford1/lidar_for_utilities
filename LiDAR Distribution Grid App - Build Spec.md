# LiDAR Distribution Grid App - Agent Build Spec

## Overview

This is an upgrade to an existing Databricks App that visualizes LiDAR point cloud data overlaid on a satellite map with H3 hexagonal grid cells. The app currently focuses on vegetation encroachment analysis for utilities. The upgrade transforms it into a **distribution grid visualization platform** with interactive asset inspection, telemetry panels, and improved UX.

**Source Repository**: https://github.com/radford1/lidar_for_utilities
**Local Path**: `/Users/david.radford/Documents/Demos/lidar_for_utilities/`
**Deployment**: Databricks App via DABs (`databricks.yml`)

---

## Current Architecture

### Tech Stack
| Component | Technology |
|-----------|-----------|
| Frontend | React 18 + TypeScript, Vite build |
| Map Rendering | DeckGL + react-map-gl (Mapbox satellite-streets-v12) |
| 3D Visualization | DeckGL PointCloudLayer in OrbitView |
| Backend | Express.js (Node) |
| Database | Databricks SQL via `@databricks/sql` (DBSQLClient) |
| Spatial Indexing | H3 (resolution 10) |
| Deployment | Databricks Apps (databricks.yml) |

### File Inventory

#### Client

**`client/src/App.tsx`** (834 lines) — Main React component. Contains ALL rendering logic:
- `MapGL` with Mapbox satellite imagery
- `DeckGL` overlay with `H3HexagonLayer` (hex grid colored by encroachment/fire/veg metrics)
- `PointCloudLayer` inside `OrbitView` modal for 3D LiDAR rendering
- `LineLayer` for pole segment connections
- `PathLayer` for conductor catenary curves between poles
- Hover tooltips on H3 cells showing metric values
- Click handler on H3 cells that **immediately** fetches points + poles and opens 3D modal
- Right-click context menu for work order creation
- Chat sidebar integration (Databricks serving endpoint)
- Current types:
  ```typescript
  LidarPoint { x, y, z, r, g, b, classification }
  Pole { pole_id, lat, lng, height_m, connects_to?, line_sag? }
  Segment { from, to, color }
  Conductor { path, color }
  ```

**`client/src/main.tsx`** — React entry point
**`client/src/index.css`** — Global styles
**`client/vite.config.ts`** — Vite config with proxy to backend :3000

#### Server

**`server/index.js`** (49 lines) — Express entry point:
- Creates a single `DatabricksSql` instance
- Attaches it to `app` as `app.db`
- Serves static client build from `../client/dist`
- Mounts routes from `routes/h3.js`

**`server/routes/h3.js`** (273 lines) — All API routes:
- `GET /api/config` — returns Mapbox token
- `GET /api/h3` — fetches all H3 cells with encroachment, fire risk, veg index (joins 3 tables)
- `GET /api/h3/:h3Hex/points` — fetches LiDAR points for a specific hex cell
- `GET /api/h3/:h3Hex/poles` — fetches poles from line topology for a hex cell
- `POST /api/workorders` — creates work orders
- `POST /api/chat` — proxies to Databricks serving endpoint for AI chat

**`server/databricks_sql.js`** (340 lines) — Databricks SQL connector wrapper:
- Wraps `@databricks/sql` DBSQLClient
- Supports token auth and OAuth M2M (via `DATABRICKS_CLIENT_ID` / `DATABRICKS_CLIENT_SECRET`)
- **PROBLEM**: Maintains a persistent session (`this.session`, `this.isConnected` flag)
- Methods: `connect()`, `query()`, `queryChunked()`, `execute()`, `getTables()`, `getSchemas()`, `getCatalogs()`, `testConnection()`, `disconnect()`

#### Data Pipeline Notebooks (in `/notebooks/`)
- `Project_Setup.py` — Creates catalog/schemas
- `Ingest_Points.py` — Ingests LiDAR point data
- `Ingest_Metadata.py` — Ingests metadata
- `Clipped_Lidar.py` — Clips LiDAR to region of interest
- `PoorMan_Clustering.py` — Clusters points
- `Static_Line_Topology.py` — Builds line topology (poles + connections)
- `Raster_Placeholder.py` — Placeholder for raster data
- `Grant_Catalog_Usage.py` — UC permissions

#### Config
- `databricks.yml` — DABs deployment config
- `client/package.json`, `server/package.json` — Dependencies

### Current Database Tables (Unity Catalog)
All referenced via `${CATALOG}` env var:
- `${catalog}.gold_lidar.dense_encroachment` — H3 cells with encroachment metrics + point data
- `${catalog}.bronze_lidar.fire_risk` — Fire risk scores per H3 cell
- `${catalog}.bronze_lidar.veg_index` — Vegetation index per H3 cell
- `${catalog}.bronze_lidar.line_topology` — Pole locations and connectivity

---

## Upgrade Requirements

### Upgrade 1: Distribution Network Topology

**Goal**: Transform the existing line topology into a realistic electric distribution network. Do NOT change any of the existing pole/asset locations. Add distribution grid components to the existing geography.

#### 1a. New Asset Types to Add

Add the following distribution network components to the data model and 3D rendering:

| Asset Type | Description | Visual Representation |
|-----------|-------------|----------------------|
| **Poles** | Already exist. Upgrade the visual to be more realistic. | 3D cylindrical wood/concrete poles with crossarms |
| **Pole-top Transformers** | Single-phase transformers mounted on poles | Gray cylindrical canister on top of pole, with bushings |
| **Reclosers** | Automatic circuit breakers on poles | Box-shaped device mounted mid-pole with visible insulators |
| **Fuses** | Cutout fuses on poles | Small cylindrical fuse tubes hanging from crossarms |
| **Conductors** | Already exist as catenary curves. Keep and improve. | Realistic wire sag with proper catenary math |

#### 1b. New Database Table: `${catalog}.silver_lidar.distribution_assets`

Create or modify the line topology table to include distribution grid components:

```sql
CREATE TABLE ${catalog}.silver_lidar.distribution_assets (
  asset_id STRING,                    -- Unique identifier
  asset_type STRING,                  -- POLE, TRANSFORMER, RECLOSER, FUSE, CONDUCTOR
  h3_index STRING,                    -- H3 cell this asset belongs to
  latitude DOUBLE,
  longitude DOUBLE,
  elevation_m DOUBLE,                 -- Height above ground (for 3D placement)
  pole_id STRING,                     -- Which pole this asset is mounted on (NULL for poles themselves)
  upstream_asset_id STRING,           -- Upstream toward substation
  downstream_asset_ids ARRAY<STRING>, -- Downstream toward customers
  feeder_id STRING,                   -- Feeder circuit identifier
  phase STRING,                       -- A, B, C, or ABC
  install_date DATE,
  manufacturer STRING,
  model STRING,
  status STRING,                      -- IN_SERVICE, OUT_OF_SERVICE, MAINTENANCE
  properties MAP<STRING, STRING>      -- Flexible key-value for asset-specific attributes
)
```

#### 1c. Hyper-Realistic 3D Rendering

The current 3D view uses basic `PointCloudLayer` with colored dots. Upgrade to make it visually impressive:

- **LiDAR points**: Keep the existing classification-based coloring but reduce point size slightly so infrastructure stands out
- **Poles**: Render as 3D cylinders with realistic proportions (35-45ft tall, ~12in diameter at base, ~8in at top). Use brown/wood texture color for wood poles, gray for concrete/steel
- **Crossarms**: Horizontal beams near top of poles where conductors attach
- **Transformers**: Gray cylindrical shapes mounted on poles (approximately 3ft tall, 2ft diameter)
- **Reclosers**: Rectangular box shapes (approximately 2ft x 1.5ft x 1ft) with mounting hardware
- **Fuses**: Small cylindrical tubes (approximately 1ft long) hanging from crossarms
- **Conductors**: Improve existing catenary curves with proper thickness and color (silver/gray for aluminum, copper for copper). Also make them 3 phase so it will need 3 conductor runs.
- **Insulators**: Small colored elements (green/brown) where conductors attach to crossarms

Use `ScenegraphLayer` or `SimpleMeshLayer` from DeckGL for 3D models if needed, or build geometry programmatically with custom layers. The key goal is that when the 3D modal opens, it looks like a realistic section of a distribution grid, not just colored dots.

#### 1d. Data Generation

Create a notebook or script that generates synthetic distribution network assets for the existing pole locations:
- Every pole gets a pole record with realistic metadata (age, material, height class)
- Every 5-8 poles, place a pole-top transformer
- Every 15-25 poles, place a recloser
- Every 8-12 poles, place a fuse
- All conductors connect between consecutive poles on the same feeder
- Assign feeder IDs based on spatial grouping of existing pole clusters
- Set upstream/downstream relationships following the feeder path

---

### Upgrade 2: Clickable Assets with Telemetry & History

**Goal**: Every distribution asset in the 3D view should be clickable. Clicking an asset opens an info panel showing telemetry data and past issues relevant to that asset type.

#### 2a. General Click Behavior

When any asset is clicked in the 3D OrbitView:
1. Identify the clicked asset by raycasting / picking
2. Open a **side panel** (not a new modal) that slides in from the right within the 3D modal
3. The panel shows asset-type-specific information (see below)
4. Panel should be dismissible by clicking X or clicking elsewhere
5. Multiple asset clicks should update the panel content, not open new panels

#### 2b. Recloser Info Panel

**Data source**: `${catalog}.silver_lidar.recloser_events`

```sql
CREATE TABLE ${catalog}.silver_lidar.recloser_events (
  event_id STRING,
  asset_id STRING,
  event_type STRING,        -- TRIP, CLOSE, LOCKOUT, TEST
  event_timestamp TIMESTAMP,
  fault_current_amps DOUBLE,
  phase_affected STRING,    -- A, B, C, or combination
  duration_ms INT,          -- Duration of event
  cause STRING,             -- VEGETATION, ANIMAL, EQUIPMENT_FAILURE, WEATHER, UNKNOWN
  auto_reclose_success BOOLEAN,
  notes STRING
)
```

**Panel contents**:
- Asset header: recloser ID, feeder, phase, manufacturer/model
- **Open Events Timeline**: A scrollable list of recent trip/close/lockout events, most recent first
  - Each event shows: timestamp, type (color-coded), fault current, phase, duration, cause
  - LOCKOUT events highlighted in red
  - TRIP events in orange
  - CLOSE events in green
- **Event Frequency Chart**: Simple bar chart or sparkline showing events per month over last 12 months
- **Status**: Current operational state (CLOSED/OPEN/LOCKED_OUT)

#### 2c. Pole-Top Transformer Info Panel

**Data source**: `${catalog}.silver_lidar.transformer_load`

```sql
CREATE TABLE ${catalog}.silver_lidar.transformer_load (
  reading_id STRING,
  asset_id STRING,
  reading_timestamp TIMESTAMP,
  load_kw DOUBLE,                -- Aggregated load from connected meters
  load_kva DOUBLE,               -- Apparent power
  power_factor DOUBLE,
  voltage_secondary DOUBLE,      -- Secondary voltage
  temperature_c DOUBLE,          -- Transformer oil/winding temperature
  percent_loading DOUBLE,        -- Load as % of rated capacity
  connected_meter_count INT,     -- Number of meters feeding this reading
  peak_demand_kw DOUBLE          -- Peak in this reading window
)
```

**Panel contents**:
- Asset header: transformer ID, feeder, kVA rating, phase, install date
- **Load Over Time Chart**: Line chart showing `load_kw` over time (default last 7 days, configurable to 30/90 days)
  - Y-axis: kW
  - Overlay line showing rated capacity for easy overload visual
  - Color zones: green (<80% loading), yellow (80-100%), red (>100%)
- **Current State**: Latest reading showing load, voltage, temperature, loading %
- **Connected Meters**: Count of downstream meters
- **Overload Events**: If any readings exceeded 100% loading, list them with timestamps

#### 2d. Pole Info Panel

Poles do NOT have real-time telemetry. Instead show inspection and environmental data.

**Data sources**:
- `${catalog}.silver_lidar.pole_attributes` (static metadata)
- `${catalog}.silver_lidar.pole_weather_stress` (computed weather impact)
- Imagery from a **Databricks Volume**: `/Volumes/${catalog}/lidar/pole_imagery/`

```sql
CREATE TABLE ${catalog}.silver_lidar.pole_attributes (
  asset_id STRING,
  pole_class INT,              -- 1-7 (structural class)
  material STRING,             -- WOOD_CEDAR, WOOD_PINE, CONCRETE, STEEL, FIBERGLASS
  height_ft DOUBLE,
  install_date DATE,
  age_years INT,               -- Computed from install_date
  expected_lifespan_years INT, -- Based on material
  remaining_life_pct DOUBLE,   -- Estimated remaining useful life
  last_inspection_date DATE,
  inspection_result STRING,    -- GOOD, FAIR, POOR, CRITICAL
  treatment STRING,            -- CCA, PENTA, CREOSOTE, NONE
  owner STRING                 -- UTILITY, TELECOM, JOINT_USE
)
```

```sql
CREATE TABLE ${catalog}.silver_lidar.pole_weather_stress (
  record_id STRING,
  asset_id STRING,
  date DATE,
  wind_speed_max_mph DOUBLE,
  wind_gust_mph DOUBLE,
  ice_accumulation_in DOUBLE,
  temperature_low_f DOUBLE,
  weather_event_type STRING,     -- THUNDERSTORM, ICE_STORM, HURRICANE, DERECHO, TORNADO_WARNING, EXTREME_HEAT, EXTREME_COLD
  stress_score DOUBLE,           -- 0-100 composite stress score
  cumulative_stress DOUBLE,      -- Running total of lifetime stress
  notes STRING
)
```

**Panel contents**:
- Asset header: pole ID, class, material, height
- **Age & Condition**:
  - Age: X years (installed YYYY-MM-DD)
  - Material with color indicator (wood types age differently)
  - Remaining life estimate as a progress bar (green/yellow/red)
  - Last inspection date and result
- **Weather Stress History**: Human-friendly visualization showing significant weather events that stressed this pole:
  - Timeline or list view: "Jan 2024 — Ice Storm: 0.75in ice accumulation, stress score 82/100"
  - Cumulative stress gauge showing lifetime accumulated stress
  - Highlight the top 3-5 most stressful events with icons (snowflake for ice, wind icon for wind, etc.)
  - Simple color-coded severity (green/yellow/orange/red)
- **Pole Imagery**: Display photos from Databricks Volume
  - Load images from `/Volumes/${catalog}/lidar/pole_imagery/${asset_id}/`
  - Show as a small image carousel/gallery within the panel
  - If no images exist for this pole, show "No imagery available"
  - Images are served via a new API endpoint (see below)

#### 2e. Fuse Info Panel

Simpler panel — fuses are passive devices.

**Panel contents**:
- Asset header: fuse ID, feeder, phase, rating (amps)
- Fuse type and rating
- Install date
- Last replacement date
- Associated protective zone (downstream asset count)

#### 2f. New API Endpoints

Add to `server/routes/h3.js` or create a new `server/routes/assets.js`:

```
GET  /api/assets/:h3Hex                        — All assets in an H3 cell (for 3D view)
GET  /api/assets/:assetId                       — Single asset detail
GET  /api/assets/:assetId/recloser-events       — Recloser event history
GET  /api/assets/:assetId/transformer-load      — Transformer load timeseries
GET  /api/assets/:assetId/pole-attributes       — Pole static attributes
GET  /api/assets/:assetId/pole-weather-stress   — Pole weather stress history
GET  /api/assets/:assetId/pole-imagery          — List of image URLs for a pole
GET  /api/imagery/:assetId/:filename            — Serve pole image from Volume
```

For the imagery endpoint, the server needs to read files from a Databricks Volume. Use the Databricks SDK or REST API to fetch file contents from `/Volumes/${catalog}/lidar/pole_imagery/`.

---

### Upgrade 3: Stateless Query Connection

**Goal**: Refactor `server/databricks_sql.js` so it does NOT maintain a persistent session. Each query should open a session, execute, and close.

#### Current Problem
The `DatabricksSql` class currently:
1. Calls `connect()` once at startup to create `this.client` and `this.session`
2. Reuses `this.session` for all subsequent queries
3. If the session times out or drops, queries fail silently or with cryptic errors
4. The `this.isConnected` flag becomes stale

#### Required Changes

Refactor the `query()` method to be fully stateless:

```javascript
// BEFORE (stateful — uses this.session)
async query(sql) {
  if (!this.isConnected) await this.connect();
  const operation = await this.session.executeStatement(sql);
  const result = await operation.fetchAll();
  await operation.close();
  return result;
}

// AFTER (stateless — creates session per query)
async query(sql) {
  const client = this.getClient(); // Lazy-init client only (not session)
  const session = await client.openSession({
    initialCatalog: this.catalog,
    initialSchema: this.schema
  });
  try {
    const operation = await session.executeStatement(sql);
    const result = await operation.fetchAll();
    await operation.close();
    return result;
  } finally {
    await session.close();
  }
}
```

Key implementation details:
- Keep a single `DBSQLClient` instance (connection pooling is handled at the client level)
- Open a new `session` for each query call
- Use `try/finally` to always close the session
- Remove `this.session`, `this.isConnected`, `connect()`, and `disconnect()` methods
- The `getClient()` method should lazy-initialize the client on first call
- Consider adding a connection pool or session pool if performance becomes an issue, but start simple

Remove the `connect()` call from `server/index.js` and any shutdown hooks for `disconnect()`.

---

### Upgrade 4: Deferred H3 Cell Rendering

**Goal**: Allow the user to select and deselect multiple H3 cells before triggering the 3D render. The current behavior is: click a cell → immediately fetch data → open 3D modal. This is frustrating because if you accidentally click or want to select multiple cells, it starts rendering prematurely.

#### Current Behavior (in `App.tsx`)
The `onClick` handler on the H3HexagonLayer immediately:
1. Sets the clicked hex as active
2. Fetches `/api/h3/${hex}/points`
3. Fetches `/api/h3/${hex}/poles`
4. Opens the 3D modal with the fetched data

#### New Behavior

**Selection Mode**:
1. **Single click** on an H3 cell → toggles it as "selected" (highlighted border/fill, distinct from the metric coloring)
2. **Click again** on a selected cell → deselects it
3. Selected cells are tracked in state as a `Set<string>` of H3 indices
4. A **floating action bar** appears at the bottom of the map when any cells are selected:
   - Shows count: "3 cells selected"
   - **"Render 3D" button** (primary action) — triggers data fetch and opens 3D modal for ALL selected cells
   - **"Clear Selection" button** — deselects all cells
5. The 3D modal fetches points and assets for ALL selected cells (batch API call)
6. After the 3D modal is closed, the selection persists on the map so the user can re-render or modify selection

#### Visual Design for Selection
- Unselected cells: current behavior (colored by metric, semi-transparent fill)
- Selected cells: bright border (white or cyan, 3px), slightly elevated opacity
- Use `H3HexagonLayer`'s `getLineWidth` and `getLineColor` to distinguish selected vs unselected

#### New/Modified API Endpoint

Instead of fetching one hex at a time, add a batch endpoint:

```
POST /api/h3/batch/points
Body: { "h3Indices": ["8a2830828a7ffff", "8a2830828b7ffff", ...] }
Response: { points: [...], assets: [...] }
```

This avoids N sequential API calls when multiple cells are selected.

---

## Synthetic Data Generation

Create a notebook (or extend existing notebooks) that generates realistic distribution network data for the existing pole locations.

### `notebooks/Generate_Distribution_Network.py`

1. **Read existing poles** from `${catalog}.bronze_lidar.line_topology`
2. **Assign feeder IDs** by spatially clustering poles (use H3 grouping or k-means)
3. **Build topology graph**: Order poles along each feeder, assign upstream/downstream relationships
4. **Place distribution assets**:
   - Every pole → insert into `distribution_assets` as type POLE with realistic metadata
   - Every 5-8 poles → place a pole-top TRANSFORMER
   - Every 15-25 poles → place a RECLOSER
   - Every 8-12 poles → place a FUSE
   - Conductors between consecutive poles on the same feeder
5. **Generate recloser events**: 5-20 events per recloser over the past 2 years, with realistic patterns (more events during storm months, occasional lockouts)
6. **Generate transformer load**: Hourly load readings for each transformer over the past 90 days. Follow a realistic diurnal curve (low at night, peak in afternoon/evening). Some transformers should be consistently overloaded.
7. **Generate pole attributes**: Age distribution from 5-60 years, mix of wood/concrete/steel. Inspection results correlate with age.
8. **Generate weather stress**: Pull from realistic weather patterns. Create 10-30 stress events per pole over their lifetime. Include 2-3 major storm events that affected all poles in an area.

### Placeholder Pole Imagery

Since imagery will be provided later:
- Create the Volume path: `/Volumes/${catalog}/lidar/pole_imagery/`
- The app should gracefully handle missing imagery (show "No imagery available")
- Optionally generate 2-3 placeholder images per pole for demo purposes

---

## Implementation Notes

### Technology Preferences
- Use **Databricks ZeroBus** for any real-time data ingestion (not Structured Streaming code)
- Use **Lakeflow Declarative Pipelines** for data transformations (medallion architecture)
- Dashboard/UI is a **Databricks App** (the existing one being upgraded)

### Package Dependencies to Add
- Consider `@loaders.gl/gltf` if using 3D models for assets
- May need chart library for telemetry panels: `recharts` or `chart.js` (lightweight, React-friendly)
- Consider `framer-motion` for smooth panel slide-in animations (optional)

### Environment Variables
Existing env vars (keep these):
- `DATABRICKS_HOST`
- `DATABRICKS_TOKEN` or `DATABRICKS_CLIENT_ID` + `DATABRICKS_CLIENT_SECRET`
- `DATABRICKS_SQL_PATH` (warehouse endpoint)
- `CATALOG`
- `MAPBOX_TOKEN`

No new env vars should be needed.

### Performance Considerations
- The batch points endpoint may return large payloads for multiple cells. Consider:
  - Server-side point decimation (return every Nth point if count exceeds threshold)
  - Streaming/chunked response for very large selections
  - Client-side progressive rendering
- Asset data is much smaller — fetch all assets for selected cells in a single query
- Telemetry queries (recloser events, transformer load) should be paginated or time-bounded
- Pole imagery should use lazy loading (don't fetch until the panel is open)

### Hydro-Quebec Connection
This app upgrade directly supports the upcoming Hydro-Quebec workshop (March 9, 2025) on "Geospatial Network Graph for the Distribution Grid." The distribution network visualization, clickable asset inspection, and H3-based spatial indexing are core capabilities they need to see for their PARDEFO initiative. The 3D rendering of distribution grid components on real LiDAR terrain is the key differentiator.

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `server/databricks_sql.js` | **Modify** | Refactor to stateless sessions |
| `server/index.js` | **Modify** | Remove connect/disconnect calls |
| `server/routes/h3.js` | **Modify** | Add batch endpoint, update existing endpoints |
| `server/routes/assets.js` | **Create** | New asset detail and telemetry endpoints |
| `client/src/App.tsx` | **Modify** | Selection state, deferred render, asset click handling, info panels |
| `client/src/components/AssetPanel.tsx` | **Create** | Side panel component for asset details |
| `client/src/components/RecloserPanel.tsx` | **Create** | Recloser-specific telemetry view |
| `client/src/components/TransformerPanel.tsx` | **Create** | Transformer load chart view |
| `client/src/components/PolePanel.tsx` | **Create** | Pole attributes, weather stress, imagery |
| `client/src/components/FusePanel.tsx` | **Create** | Fuse detail view |
| `client/src/components/SelectionBar.tsx` | **Create** | Floating action bar for cell selection |
| `notebooks/Generate_Distribution_Network.py` | **Create** | Synthetic data generation |

---

## Build Order

An agent should implement these upgrades in this order:

1. **Stateless query connection** (Upgrade 3) — Smallest change, foundational for everything else
2. **Deferred H3 selection UX** (Upgrade 4) — Improves developer experience for testing subsequent changes
3. **Distribution network data model + generation** (Upgrade 1 data) — Creates the tables and synthetic data needed
4. **Distribution network 3D rendering** (Upgrade 1 rendering) — Renders the new asset types in the 3D view
5. **Clickable assets + info panels** (Upgrade 2) — Adds interactivity to the 3D-rendered assets
6. **Telemetry API endpoints** (Upgrade 2 backend) — Connects panels to real data
7. **Polish** — Loading states, error handling, panel animations, performance tuning
