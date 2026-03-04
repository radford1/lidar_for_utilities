# Databricks notebook source
# MAGIC %md
# MAGIC # Generate Distribution Pole Data
# MAGIC
# MAGIC Generates synthetic pole attributes, weather stress events, and work order
# MAGIC history for existing poles in `bronze_lidar.line_topology`.
# MAGIC
# MAGIC Tables created (in `silver_lidar` schema):
# MAGIC - `pole_attributes` — age, material, class, inspection data
# MAGIC - `pole_weather_stress` — historical weather stress events per pole
# MAGIC - `pole_work_orders` — historical work orders per pole

# COMMAND ----------

import random
import hashlib
from datetime import datetime, timedelta
from pyspark.sql import Row
from pyspark import pipelines as dp

# Deterministic seed per pole_id
def seed_for(pole_id, salt=""):
    h = hashlib.md5(f"{pole_id}{salt}".encode()).hexdigest()
    return int(h[:8], 16)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Pole Attributes

# COMMAND ----------

@dp.table(
    name="silver_lidar.pole_attributes",
    comment="Synthetic pole metadata generated from line_topology pole IDs"
)
def generate_pole_attributes():
    poles = spark.table(f"{spark.conf.get('source_catalog')}.bronze_lidar.line_topology")
    pole_ids = [row.pole_id for row in poles.select("pole_id").distinct().collect()]

    materials = ["WOOD_CEDAR", "WOOD_PINE", "CONCRETE", "STEEL", "FIBERGLASS"]
    material_weights = [35, 30, 15, 12, 8]
    treatments = ["CCA", "PENTA", "CREOSOTE", "NONE"]
    inspection_results = ["GOOD", "FAIR", "POOR", "CRITICAL"]
    owners = ["UTILITY", "TELECOM", "JOINT_USE"]
    lifespan_map = {"WOOD_CEDAR": 50, "WOOD_PINE": 40, "CONCRETE": 70, "STEEL": 60, "FIBERGLASS": 45}

    rows = []
    for pid in pole_ids:
        rng = random.Random(seed_for(pid))
        material = rng.choices(materials, weights=material_weights, k=1)[0]
        age_years = rng.randint(5, 55)
        install_date = datetime.now() - timedelta(days=age_years * 365 + rng.randint(0, 364))
        expected_lifespan = lifespan_map.get(material, 50)
        remaining_life_pct = max(0.0, min(100.0, (expected_lifespan - age_years) / expected_lifespan * 100))
        height_ft = round(35 + rng.random() * 15, 1)
        pole_class = rng.randint(1, 5)

        if age_years > 40:
            insp_idx = min(3, rng.randint(2, 3))
        elif age_years > 25:
            insp_idx = rng.randint(0, 2)
        else:
            insp_idx = rng.randint(0, 1)
        inspection_result = inspection_results[insp_idx]

        last_insp = datetime.now() - timedelta(days=rng.randint(30, 3 * 365))
        treatment = rng.choice(treatments[:3]) if material.startswith("WOOD") else "NONE"
        owner = rng.choice(owners)

        rows.append(Row(
            asset_id=str(pid),
            pole_class=pole_class,
            material=material,
            height_ft=height_ft,
            install_date=install_date.date(),
            age_years=age_years,
            expected_lifespan_years=expected_lifespan,
            remaining_life_pct=round(remaining_life_pct, 1),
            last_inspection_date=last_insp.date(),
            inspection_result=inspection_result,
            treatment=treatment,
            owner=owner,
        ))

    return spark.createDataFrame(rows)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Weather Stress Events

# COMMAND ----------

@dp.table(
    name="silver_lidar.pole_weather_stress",
    comment="Synthetic weather stress events for each pole"
)
def generate_weather_stress():
    poles = spark.table(f"{spark.conf.get('source_catalog')}.bronze_lidar.line_topology")
    pole_ids = [row.pole_id for row in poles.select("pole_id").distinct().collect()]

    event_types = [
        "THUNDERSTORM", "ICE_STORM", "HURRICANE", "DERECHO",
        "TORNADO_WARNING", "EXTREME_HEAT", "EXTREME_COLD",
    ]

    rows = []
    for pid in pole_ids:
        rng = random.Random(seed_for(pid, "weather"))
        event_count = rng.randint(10, 25)
        cumulative = 0.0

        events = []
        for i in range(event_count):
            years_ago = rng.random() * 20
            event_date = datetime.now() - timedelta(days=int(years_ago * 365))
            event_type = rng.choice(event_types)
            wind_speed = round(20 + rng.random() * 60, 1)
            wind_gust = round(wind_speed + rng.random() * 30, 1)
            ice_accum = round(rng.random() * 1.5, 2) if event_type == "ICE_STORM" else 0.0
            temp_low = round(-20 + rng.random() * 15) if event_type == "EXTREME_COLD" else round(20 + rng.random() * 40)
            stress_score = round(min(100.0, 20 + rng.random() * 80), 1)

            events.append((event_date, event_type, wind_speed, wind_gust, ice_accum, temp_low, stress_score, i))

        events.sort(key=lambda x: x[0])

        for event_date, event_type, wind_speed, wind_gust, ice_accum, temp_low, stress_score, i in events:
            cumulative += stress_score
            rows.append(Row(
                record_id=f"ws_{pid}_{i}",
                asset_id=str(pid),
                date=event_date.date(),
                wind_speed_max_mph=wind_speed,
                wind_gust_mph=wind_gust,
                ice_accumulation_in=ice_accum,
                temperature_low_f=int(temp_low),
                weather_event_type=event_type,
                stress_score=stress_score,
                cumulative_stress=round(cumulative, 1),
                notes="",
            ))

    return spark.createDataFrame(rows)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Work Orders

# COMMAND ----------

@dp.table(
    name="silver_lidar.pole_work_orders",
    comment="Synthetic historical work orders for each pole"
)
def generate_work_orders():
    poles = spark.table(f"{spark.conf.get('source_catalog')}.bronze_lidar.line_topology")
    pole_ids = [row.pole_id for row in poles.select("pole_id").distinct().collect()]

    wo_types = ["INSPECTION", "REPAIR", "REPLACEMENT", "VEGETATION_TRIM", "EMERGENCY", "UPGRADE"]
    statuses = ["COMPLETED", "OPEN", "IN_PROGRESS", "CANCELLED"]
    descriptions = {
        "INSPECTION": ["Annual pole inspection", "Detailed structural assessment", "Visual inspection after storm", "Scheduled 5-year inspection"],
        "REPAIR": ["Replaced damaged crossarm", "Repaired conductor attachment hardware", "Fixed ground wire connection", "Patched woodpecker damage"],
        "REPLACEMENT": ["Full pole replacement due to age", "Emergency pole replacement after vehicle impact", "Scheduled pole replacement - end of life"],
        "VEGETATION_TRIM": ["Trimmed overhanging branches within 10ft zone", "Removed vine growth on pole", "Cleared brush around pole base"],
        "EMERGENCY": ["Storm damage response - leaning pole", "Downed conductor reattachment", "Transformer fire response"],
        "UPGRADE": ["Upgraded crossarm hardware", "Added new conductor support", "Installed wildlife guard"],
    }

    rows = []
    for pid in pole_ids:
        rng = random.Random(seed_for(pid, "workorders"))
        count = rng.randint(2, 6)

        for i in range(count):
            years_ago = rng.random() * 10
            wo_date = datetime.now() - timedelta(days=int(years_ago * 365))
            wo_type = rng.choice(wo_types)
            desc_list = descriptions.get(wo_type, ["General maintenance"])
            desc = rng.choice(desc_list)
            status = "COMPLETED" if years_ago > 1 else rng.choice(statuses)
            crew = f"Crew-{rng.randint(1, 20)}"
            est_hours = round(1 + rng.random() * 8, 1)

            rows.append(Row(
                work_order_id=f"WO-{pid}-{str(i + 1).zfill(3)}",
                asset_id=str(pid),
                date=wo_date.date(),
                work_type=wo_type,
                description=desc,
                status=status,
                crew=crew,
                estimated_hours=est_hours,
            ))

    return spark.createDataFrame(rows)
