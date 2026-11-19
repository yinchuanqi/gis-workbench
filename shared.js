/** Shared constants between the Host tool and the Client map. */
export const TOOL_NAME = 'gis_add_layer';
export const VIEW_TOOL_NAME = 'gis_set_view';
export const DEFAULT_LAYER_NAME = '天地图影像';
export const DEFAULT_TILE_URL = '//your-tile-host/api/gis-map-service/world-map-tiles/images/tiandi-image-3857/{z}/{x}/{y}';
export const DEFAULT_TILE_SIZE = 256;
export const DEFAULT_ATTRIBUTION = '天地图';
export const DEFAULT_VIEW_ZOOM = 11;

/**
 * Small built-in gazetteer the Host resolves when a view request names a place
 * instead of raw coordinates. Keys are lower-case latin aliases; every entry
 * carries the Chinese label shown in the UI.
 */
export const PLACE_PRESETS = {
  hangzhou: { label: '中国 · 杭州', center: [120.1551, 30.2741], zoom: 11 },
  '杭州': { label: '中国 · 杭州', center: [120.1551, 30.2741], zoom: 11 },
  beijing: { label: '中国 · 北京', center: [116.4074, 39.9042], zoom: 11 },
  '北京': { label: '中国 · 北京', center: [116.4074, 39.9042], zoom: 11 },
  shanghai: { label: '中国 · 上海', center: [121.4737, 31.2304], zoom: 11 },
  '上海': { label: '中国 · 上海', center: [121.4737, 31.2304], zoom: 11 },
  shenzhen: { label: '中国 · 深圳', center: [114.0579, 22.5431], zoom: 11 },
  '深圳': { label: '中国 · 深圳', center: [114.0579, 22.5431], zoom: 11 },
  guangzhou: { label: '中国 · 广州', center: [113.2644, 23.1291], zoom: 11 },
  '广州': { label: '中国 · 广州', center: [113.2644, 23.1291], zoom: 11 },
  chengdu: { label: '中国 · 成都', center: [104.0665, 30.5723], zoom: 11 },
  '成都': { label: '中国 · 成都', center: [104.0665, 30.5723], zoom: 11 },
  xian: { label: '中国 · 西安', center: [108.9398, 34.3416], zoom: 11 },
  '西安': { label: '中国 · 西安', center: [108.9398, 34.3416], zoom: 11 },
  china: { label: '中国', center: [104.2, 35.5], zoom: 3.4 },
  '中国': { label: '中国', center: [104.2, 35.5], zoom: 3.4 },
};
export const LIST_LAYERS_TOOL_NAME = 'gis_list_layers';
export const DESCRIBE_LAYER_TOOL_NAME = 'gis_describe_layer';
export const SAMPLE_FIELD_TOOL_NAME = 'gis_sample_field';
export const MAP_CAPABILITIES_TOOL_NAME = 'gis_map_capabilities';
export const UPDATE_STYLE_TOOL_NAME = 'gis_update_layer_style';
