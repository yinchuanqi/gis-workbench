import json
import sys
from osgeo import ogr

path = sys.argv[1]
layer_name = sys.argv[2] if len(sys.argv) > 2 else None
ds = ogr.Open(path, 0)
if ds is None:
    raise SystemExit('Cannot open vector dataset: ' + path)


def layer_info(layer):
    extent = layer.GetExtent()
    fields = []
    definition = layer.GetLayerDefn()
    for index in range(definition.GetFieldCount()):
        field = definition.GetFieldDefn(index)
        fields.append({'name': field.GetName(), 'type': field.GetTypeName()})
    srs = layer.GetSpatialRef()
    epsg = None
    if srs is not None:
        try:
            srs.AutoIdentifyEPSG()
            code = srs.GetAuthorityCode(None)
            if code:
                epsg = int(code)
        except Exception:
            pass
    return {
        'name': layer.GetName(),
        'featureCount': layer.GetFeatureCount(),
        'extent': list(extent) if extent else None,
        'bbox': [extent[0], extent[2], extent[1], extent[3]] if extent else None,
        'fields': fields,
        'geometryType': ogr.GeometryTypeToName(layer.GetGeomType()),
        'crs': epsg,
    }

if layer_name:
    layer = ds.GetLayerByName(layer_name)
    if layer is None:
        raise SystemExit('Layer not found: ' + layer_name)
    print(json.dumps({'layer': layer_info(layer)}))
else:
    layers = []
    for index in range(ds.GetLayerCount()):
        layers.append(layer_info(ds.GetLayerByIndex(index)))
    print(json.dumps({'layers': layers}))
