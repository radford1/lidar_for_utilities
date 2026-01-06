from pyspark import pipelines as dp



@dp.table(
    name = "silver_lidar.clipped_lidar"
)
def clipped_lidar():
  return spark.sql("""
            WITH line_strings AS (
              SELECT
                st_makeline(array(st_point(A.lng, A.lat, 4326), st_point(B.lng, B.lat, 4326))) AS wire,
                A.h3_10,
                explode(h3_kring(A.h3_10,1)) as h3_10_ring
              FROM
                bronze_lidar.line_topology A
                  JOIN bronze_lidar.line_topology B
                    ON A.pole_id = B.connects_to
            )
            SELECT
            distinct
              st_distance(
                st_transform(st_point(B.longitude, B.latitude, 4326), 32616),
                st_transform(wire, 32616)

              ) AS distance_meters,
              B.latitude,
              B.longitude,
              B.z,
              B.x,
              B.y,
              B.normalized_z,
              B.classification,
              B.h3_10
            FROM
              line_strings
                JOIN bronze_lidar.point_cloud B
                  ON 
                  st_distance(
                    st_transform(st_point(B.longitude, B.latitude, 4326), 32616),
                    st_transform(wire, 32616)

                  ) < 20
                  and B.h3_10=line_strings.h3_10_ring
                  """)