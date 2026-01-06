# Databricks notebook source
dbutils.widgets.text("CATALOG","")
dbutils.widgets.text("WAREHOUSE_ID","")
dbutils.widgets.text("MAPBOX_TOKEN","")
CATALOG = dbutils.widgets.get("CATALOG")
WAREHOUSE_ID = dbutils.widgets.get("WAREHOUSE_ID")
MAPBOX_TOKEN = dbutils.widgets.get("MAPBOX_TOKEN")

host = spark.conf.get("spark.databricks.workspaceUrl")

app_yaml = f"""
command: ["npm", "start"]
env:
  - name: 'DATABRICKS_SERVER_HOSTNAME'
    value: '{host}'
  - name: CATALOG
    value: {CATALOG}
  - name: 'DATABRICKS_HTTP_PATH'
    value: '/sql/1.0/warehouses/{WAREHOUSE_ID}'
  - name: MAPBOX_TOKEN
    value: {MAPBOX_TOKEN}
"""

with open("../server/app.yaml", "w") as f:
    f.write(app_yaml)
# COMMAND ----------

# MAGIC %sql
# MAGIC create schema if not exists identifier(:CATALOG||'.bronze_lidar');
# MAGIC create volume if not exists identifier(:CATALOG||'.bronze_lidar.lidar_data')

# COMMAND ----------

import os
dbutils.fs.rm(f'/Volumes/{CATALOG}/bronze_lidar/lidar_data/laz/',recurse=True)
os.makedirs(f'/Volumes/{CATALOG}/bronze_lidar/lidar_data/laz/', exist_ok=True)

# COMMAND ----------

# Download the file to a local path, then copy to Unity Catalog volume
import requests
import shutil

urls = [
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH570570.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH570600.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH570615.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH585570.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH585600.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH585615.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH600570.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH600615.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH615615.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH570585.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH585585.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH600585.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_Central_Valley_LiDAR_2016_D16/CA_Central_Valley_2017/LAZ/USGS_LPC_CA_Central_Valley_LiDAR_2016_D16_10SFH600600.laz",
  "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/LPC/Projects/CA_FEMALevee_D23/CA_FEMALevee_1_D23/LAZ/USGS_LPC_CA_FEMALevee_D23_65792572.laz",
]

for url in urls:
  # Extract filename from URL
  filename = url.split("/")[-1]
  local_path = f"/tmp/{filename}"
  volume_path = f"/Volumes/{CATALOG}/bronze_lidar/lidar_data/laz/{filename}"
  
  response = requests.get(url, stream=True)
  with open(local_path, "wb") as f:
    for chunk in response.iter_content(chunk_size=8192):
      f.write(chunk)
  shutil.copy(local_path, volume_path)

# COMMAND ----------



