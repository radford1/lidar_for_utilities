from pyspark import pipelines as dp
from pyspark.sql.functions import col, count, count_if, udf
import laspy, pyproj
import pandas as pd
import io
from typing import Iterator
import numpy as np
from sklearn.neighbors import KDTree

BATCH_SIZE = 1_000_000
# lidar_path = "/Volumes/aa_data_sandbox/de_poc/image_vol/LiDAR_images/"

@udf("int")
def get_point_count(file_name):
    import laspy
    with laspy.open(file_name, laz_backend="lazrs") as reader:
        return reader.header.point_count

@udf("array<int>")
def get_point_split(total_points):
    start_points = np.arange(0, total_points, BATCH_SIZE)
    return start_points.tolist()






parsed_schema = "latitude double, longitude double, x double, y double, z double, intensity int, return_number int, number_of_returns int, classification int, gps_time double, file_id bigint, normalized_z double"
def parse_las_in_chunks(pdf: Iterator[pd.DataFrame]):
    for batch in pdf:
        for row in batch.itertuples(index=False):
            file_name = row.file_name
            file_id = row.file_id
            start = int(row.point_split)
            with laspy.open(file_name) as las:    

                las.seek(start)
                pts = las.read_points(BATCH_SIZE)
                indices = np.arange(len(pts))
                dfs = []
                # transformer = pyproj.Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
                transformer = pyproj.Transformer.from_crs("EPSG:6339", "EPSG:4326", always_xy=True)
                longitude, latitude = transformer.transform(pts.x[indices], pts.y[indices])
                df = {
                    "latitude":  np.array(latitude, dtype=np.float64),
                    "longitude": np.array(longitude, dtype=np.float64),
                    "x": np.array(pts.x)[indices],
                    "y": np.array(pts.y)[indices],
                    "z": np.array(pts.z)[indices],
                    "intensity": np.array(pts.intensity)[indices],
                    "return_number": np.array(pts.return_number)[indices],
                    "number_of_returns": np.array(pts.num_returns)[indices],
                    "classification": np.array(pts.classification)[indices],
                    "gps_time": np.array(pts.gps_time)[indices],
                    "file_id": file_id
                }
            df = pd.DataFrame(df)

            #normalize z to ground
            ground_mask = df["classification"] == 2
            ground_xyz = df.loc[ground_mask, ["x", "y", "z"]].values
            # KDTree nearest neighbor lookup
            tree = KDTree(ground_xyz[:, :2])
            dist, idx = tree.query(df[["x", "y"]].values, k=1)
            ground_z = ground_xyz[idx[:, 0], 2]

            # Compute height above ground (normalized Z)
            df["normalized_z"] = df["z"] - ground_z

            yield df



@dp.table(
    name="bronze_lidar.point_cloud"
)
def bronze_lidar_points():
    lidar_file_paths = (
        spark.readStream.table("bronze_lidar.point_metadata")
    )

    return (
        lidar_file_paths
        .withColumn("point_splits", get_point_split("metadata.point_count"))
        .selectExpr("path as file_name","explode(point_splits) as point_split", "file_id")
        .mapInPandas(parse_las_in_chunks, schema=parsed_schema)
        .selectExpr("*","h3_longlatash3string(longitude, latitude, 10) as h3_10")
    )



