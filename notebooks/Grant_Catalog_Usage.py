# Databricks notebook source
# COMMAND ----------
dbutils.widgets.text("CATALOG","")
dbutils.widgets.text("PRINCIPAL","")
PRINCIPAL = dbutils.widgets.get("PRINCIPAL")
CATALOG = dbutils.widgets.get("CATALOG")

# COMMAND ----------
spark.sql(f"grant use catalog on catalog {CATALOG} to `{PRINCIPAL}`")
spark.sql(f"grant use schema on schema {CATALOG}.bronze_lidar to `{PRINCIPAL}`")
spark.sql(f"grant use schema on schema {CATALOG}.gold_lidar to `{PRINCIPAL}`")
spark.sql(f"grant select on schema {CATALOG}.bronze_lidar to `{PRINCIPAL}`")
spark.sql(f"grant select on schema {CATALOG}.gold_lidar to `{PRINCIPAL}`")

spark.sql(f"""CREATE OR REPLACE FUNCTION {CATALOG}.gold_lidar.get_points_around_latlng(input_lat DOUBLE, input_lng DOUBLE)
RETURNS TABLE (x DOUBLE, y DOUBLE, z DOUBLE, distance_meters DOUBLE, classification STRING)
RETURN
WITH center_h3 AS (
  SELECT h3_longlatash3string(input_lng, input_lat , 10) AS h3_10_center
),
neighbors AS (
  SELECT explode(h3_kring(h3_10_center, 1)) AS h3_10_neighbor
  FROM center_h3
),
distance_meas as (SELECT 
  d.x, 
  d.y, 
  d.z, 
  st_distance(st_transform(st_point(input_lng, input_lat, 4326), 32616), st_transform(st_point(d.lng, d.lat, 4326), 32616)) AS distance,
  classification
FROM {CATALOG}.gold_lidar.dense_encroachment d
JOIN neighbors n
  ON d.h3_10 = n.h3_10_neighbor)
  select x,y,z,distance, 'ground' as classification from distance_meas where distance <=30  and classification=2;""")

