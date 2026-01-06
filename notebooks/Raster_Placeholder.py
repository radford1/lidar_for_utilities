from pyspark import pipelines as dp

@dp.table(
    name = "bronze_lidar.fire_risk"
)
def bronze_fire_risk():
  return spark.sql("""
                   with h3 as(select distinct h3_10 from bronze_lidar.point_cloud)
                   select h3.h3_10, cast(uniform(0, 100) as int) as fire_risk from h3
                   """)
  

@dp.table(
  name = "bronze_lidar.veg_index"
)
def bronze_veg_index():
  return (
    spark.sql("""
              with h3 as(select distinct h3_10 from bronze_lidar.point_cloud)
              select h3.h3_10, cast(uniform(0, 100) as int) as veg_index from h3""")
  )