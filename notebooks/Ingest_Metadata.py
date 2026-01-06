from pyspark import pipelines as dp
from pyspark.sql.functions import col, udf

from typing import Iterator

metadata_schema = "struct<file_name:string,point_count:int,x_scale:double,y_scale:double,z_scale:double,x_offset:double,y_offset:double,z_offset:double,epsg:int,proj4:string,srs_wkt:string,min_x:double,min_y:double,min_z:double,max_x:double,max_y:double,max_z:double,ingestion_dttm timestamp,exception string>"

table_schema = f"path string, length bigint, metadata {metadata_schema}, file_id bigint generated always as identity"


@udf(metadata_schema)
def extract_metadata(file_name):
    import laspy
    from datetime import datetime
    import pytz
    rows = []
    cst = pytz.timezone("US/Central")
    ingestion_dttm = datetime.now(cst)
    with laspy.open(file_name, laz_backend="lazrs") as reader:
        h = reader.header
        crs = h.parse_crs()
        metadata = {
            "file_name": file_name,
            "point_count": h.point_count,
            "x_scale": h.scales[0].item(),
            "y_scale": h.scales[1].item(),
            "z_scale": h.scales[2].item(),
            "x_offset": h.offsets[0].item(),
            "y_offset": h.offsets[1].item(),
            "z_offset": h.offsets[2].item(),
            "epsg": crs.to_epsg() if crs else None,
            "proj4": crs.to_proj4() if crs else None,
            "srs_wkt": crs.to_wkt() if crs else None,
            "min_x": h.mins[0].item(),
            "min_y": h.mins[1].item(),
            "min_z": h.mins[2].item(),
            "max_x": h.maxs[0].item(),
            "max_y": h.maxs[1].item(),
            "max_z": h.maxs[2].item(),
            "ingestion_dttm": ingestion_dttm,
            "exception": None,
        }
    return metadata
catalog = spark.conf.get("source_catalog")
lidar_path = f"/Volumes/{catalog}/bronze_lidar/lidar_data"
@dp.table(
    name="bronze_lidar.point_metadata",
    schema=table_schema
)
def bronze_lidar_metadata():
    lidar_file_paths = (
        spark.readStream.format("cloudFiles")
        .option("cloudFiles.format", "binaryFile")
        .load(f"{lidar_path}/laz")
        .selectExpr("replace(path, 'dbfs:', '') as path", "length")
        .filter(col("path").rlike(r"\.(laz)$"))
    )
    return lidar_file_paths.withColumn("metadata", extract_metadata("path"))