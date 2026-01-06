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

