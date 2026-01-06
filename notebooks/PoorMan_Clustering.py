from pyspark import pipelines as dp


@dp.view(name="encroaching_view")
def encroaching_view():
    return spark.sql(
        f"""
            select *, true as is_encroaching from silver_lidar.clipped_lidar
            where normalized_z between 5 and 25 and distance_meters between 0 and 15"""
    )


@dp.table(name="gold_lidar.dense_encroachment")
def gold_clustered_points():

    return spark.sql(
        """
        with close_points as(
            select A.*, b.is_encroaching as counter from encroaching_view A
            left join encroaching_view B 
            on st_distance(
                st_geomfromtext(concat('POINT Z (', A.x, ' ', A.y, ' ', A.z, ')')),
                st_geomfromtext(concat('POINT Z (', B.x, ' ', B.y, ' ', B.z, ')'))
            ) < 1 
            and A.x <> B.x 
            and A.y <> B.y 
            and A.z <> B.z 
            and h3_toparent(A.h3_10,9) = h3_toparent(B.h3_10,9)
        ),
        agg_points as(
            select collect_list(counter) total_points, x,y,z 
            from close_points group by x,y,z),
        dense_points as (
            select x,y,z from agg_points 
            where size(total_points) > 10)
        select orig.* except(latitude, longitude),
        latitude as lat, 
        longitude as lng, 
        case when dense_points.x is not null then true else false end as is_encroaching 
        from bronze_lidar.point_cloud orig
        left join dense_points using(x,y,z)
"""
    )
