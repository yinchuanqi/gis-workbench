import json
import os
import sys

try:
    import psycopg
    cfg = json.loads(os.environ.get('GIS_PG_CONFIG', '{}'))
    conn = psycopg.connect(
        host=cfg.get('host'),
        port=int(cfg.get('port') or 5432),
        dbname=cfg.get('dbname'),
        user=cfg.get('username'),
        password=cfg.get('password'),
        sslmode=cfg.get('sslmode') or 'prefer',
        connect_timeout=5,
        application_name='dsh-gis-workbench',
    )
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT f_table_schema, f_table_name, f_geometry_column, srid, type
                FROM geometry_columns
                WHERE f_table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY f_table_schema, f_table_name
            """)
            geometry = cur.fetchall()
            cur.execute("""
                SELECT table_schema, table_name, column_name
                FROM information_schema.columns
                WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
                ORDER BY table_schema, table_name, ordinal_position
            """)
            column_rows = cur.fetchall()
        columns = {}
        for schema, table, column in column_rows:
            columns.setdefault((schema, table), []).append(column)
        tables = []
        for schema, table, geometry_column, srid, geometry_type in geometry:
            tables.append({
                'schema': schema,
                'table': table,
                'geometryColumn': geometry_column,
                'srid': srid,
                'geometryType': geometry_type,
                'columns': columns.get((schema, table), []),
            })
        print(json.dumps({'tables': tables}))
    finally:
        conn.close()
except Exception as error:
    print(json.dumps({'error': str(error)[:500]}))
    sys.exit(1)
