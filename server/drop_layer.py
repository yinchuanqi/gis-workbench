import sys
from osgeo import gdal

path, name = sys.argv[1], sys.argv[2]
ds = gdal.OpenEx(path, gdal.OF_UPDATE)
if ds is None:
    raise SystemExit(0)
for index in range(ds.GetLayerCount()):
    if ds.GetLayerByIndex(index).GetName() == name:
        ds.DeleteLayer(index)
        break
ds = None
