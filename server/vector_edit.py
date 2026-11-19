import json
import os
import sqlite3
import sys
from osgeo import ogr, osr

command = sys.argv[1]
cfg = json.loads(os.environ.get('GIS_VECTOR_EDIT', '{}'))
gpkg = cfg['gpkg']
table = cfg['table']


def open_gpkg(update):
    driver = ogr.GetDriverByName('GPKG')
    ds = ogr.Open(gpkg, 1 if update else 0)
    if ds is None and update:
        ds = driver.CreateDataSource(gpkg)
    if ds is None:
        raise RuntimeError('Cannot open GeoPackage: ' + gpkg)
    return ds


def update_contents(extent):
    if extent is None:
        return
    db = sqlite3.connect(gpkg)
    db.execute(
        'UPDATE gpkg_contents SET min_x=?, min_y=?, max_x=?, max_y=? WHERE table_name=?',
        (extent[0], extent[2], extent[1], extent[3], table),
    )
    db.commit()
    db.close()


if command == 'create':
    ds = open_gpkg(True)
    existing = ds.GetLayerByName(table)
    if existing is not None:
        raise RuntimeError('Layer already exists: ' + table)
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)
    layer = ds.CreateLayer(table, srs, ogr.wkbMultiPolygon)
    if layer is None:
        raise RuntimeError('Cannot create layer: ' + table)
    layer.CreateField(ogr.FieldDefn('name', ogr.OFTString))
    layer.CreateField(ogr.FieldDefn('created_at', ogr.OFTString))
    ds = None
    print(json.dumps({'table': table, 'geometryType': 'MultiPolygon', 'fields': ['name', 'created_at']}))
    sys.exit(0)

if command == 'add':
    geometry_json = cfg['geometry']
    geometry = ogr.CreateGeometryFromJson(json.dumps(geometry_json))
    if geometry is None:
        raise RuntimeError('Invalid GeoJSON geometry')
    if geometry.GetGeometryType() == ogr.wkbPolygon:
        geometry = ogr.ForceToMultiPolygon(geometry)
    if geometry.GetGeometryType() != ogr.wkbMultiPolygon:
        raise RuntimeError('Only Polygon/MultiPolygon geometry is supported')
    ds = open_gpkg(True)
    layer = ds.GetLayerByName(table)
    if layer is None:
        raise RuntimeError('Layer not found: ' + table)
    feature = ogr.Feature(layer.GetLayerDefn())
    feature.SetField('name', cfg.get('name') or '未命名多边形')
    feature.SetField('created_at', cfg.get('createdAt') or '')
    feature.SetGeometry(geometry)
    layer.CreateFeature(feature)
    extent = layer.GetExtent(1)
    feature_count = layer.GetFeatureCount()
    layer = None
    ds = None
    update_contents(extent)
    print(json.dumps({'featureCount': feature_count, 'extent': list(extent)}))
    sys.exit(0)

if command == 'update':
    target_name = cfg.get('name')
    target_created = cfg.get('createdAt')
    geometry = ogr.CreateGeometryFromJson(json.dumps(cfg['geometry']))
    if geometry is None:
        raise RuntimeError('Invalid GeoJSON geometry')
    if geometry.GetGeometryType() == ogr.wkbPolygon:
        geometry = ogr.ForceToMultiPolygon(geometry)
    if geometry.GetGeometryType() != ogr.wkbMultiPolygon:
        raise RuntimeError('Only Polygon/MultiPolygon geometry is supported')
    ds = open_gpkg(True)
    layer = ds.GetLayerByName(table)
    if layer is None:
        raise RuntimeError('Layer not found: ' + table)
    found = 0
    for feature in layer:
        if target_name is not None and feature.GetField('name') != target_name:
            continue
        if target_created is not None and feature.GetField('created_at') != target_created:
            continue
        feature.SetGeometry(geometry)
        layer.SetFeature(feature)
        found += 1
        break
    feature_count = layer.GetFeatureCount()
    extent = layer.GetExtent(1)
    layer = None
    ds = None
    update_contents(extent)
    print(json.dumps({'updated': found, 'featureCount': feature_count, 'extent': list(extent)}))
    sys.exit(0)

if command == 'delete':
    target_name = cfg.get('name')
    target_created = cfg.get('createdAt')
    ds = open_gpkg(True)
    layer = ds.GetLayerByName(table)
    if layer is None:
        raise RuntimeError('Layer not found: ' + table)
    deleted = 0
    for feature in layer:
        if target_name is not None and feature.GetField('name') != target_name:
            continue
        if target_created is not None and feature.GetField('created_at') != target_created:
            continue
        layer.DeleteFeature(feature.GetFID())
        deleted += 1
        break
    feature_count = layer.GetFeatureCount()
    extent = layer.GetExtent(1) if feature_count > 0 else None
    layer = None
    ds = None
    update_contents(extent)
    print(json.dumps({'deleted': deleted, 'featureCount': feature_count, 'extent': list(extent) if extent else None}))
    sys.exit(0)

raise SystemExit('Unknown command: ' + command)
