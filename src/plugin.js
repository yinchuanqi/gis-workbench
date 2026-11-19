import maplibreDefault from 'maplibre-gl';
import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css';
import {
  DEFAULT_ATTRIBUTION,
  DEFAULT_LAYER_NAME,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILE_URL,
  TOOL_NAME,
  VIEW_TOOL_NAME,
  UPDATE_STYLE_TOOL_NAME,
} from '../shared.js';
import { MAP_GLYPHS_URL } from '../style-schema.js';
import {
  addLayer,
  getLayers,
  getView,
  removeLayer,
  reorderLayers,
  replaceProjectLayers,
  updateProjectLayerStyle,
  resolveTileUrl,
  setView,
  subscribe,
  toggleLayerVisibility,
} from './store.js';
import { BASE_CSS } from './styles.js';
import * as api from './api.js';

const maplibregl = maplibreDefault && maplibreDefault.Map ? maplibreDefault : maplibreDefault.default;
let React;
let h;
let useState;
let useEffect;
let useRef;
let useCallback;
let useMemo;
let ChatBoundary;
let workbenchOpen = false;
const workbenchListeners = new Set();
const NS = 'gisWorkbench';
const CHAT_KIND = 'gis-chat';
const CHAT_ID = '@yinchuanqi/gis-workbench/chat';
const TOOL_VIEW_KEY = TOOL_NAME;
const DEFAULT_CENTER = [104.2, 35.5];
const DEFAULT_ZOOM = 3.4;
function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function ringCentroid(ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[index + 1];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    x += (x1 + x2) * cross;
    y += (y1 + y2) * cross;
  }
  if (Math.abs(twiceArea) < 1e-12) {
    const points = ring.slice(0, -1);
    if (points.length === 0) return null;
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

function geometryLabelPoint(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  if (geometry.type === 'Point') return geometry.coordinates.slice(0, 2);
  if (geometry.type === 'MultiPoint') {
    const points = geometry.coordinates;
    if (points.length === 0) return null;
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  }
  if (geometry.type === 'LineString') {
    const points = geometry.coordinates;
    return points.length > 0 ? points[Math.floor(points.length / 2)].slice(0, 2) : null;
  }
  if (geometry.type === 'MultiLineString') {
    const lines = geometry.coordinates;
    return lines.length > 0 ? geometryLabelPoint({ type: 'LineString', coordinates: lines[0] }) : null;
  }
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0];
    if (!ring || ring.length < 4) return null;
    return ringCentroid(ring);
  }
  if (geometry.type === 'MultiPolygon') {
    let best = null;
    let bestArea = -Infinity;
    for (const polygon of geometry.coordinates) {
      const ring = polygon && polygon[0];
      if (!ring || ring.length < 4) continue;
      const area = Math.abs(ringArea(ring));
      if (area > bestArea) {
        bestArea = area;
        best = ringCentroid(ring);
      }
    }
    return best;
  }
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries || []) {
      const point = geometryLabelPoint(child);
      if (point) return point;
    }
  }
  return null;
}

function categoricalFillExpression(categorical, fallbackColor) {
  if (!categorical || !categorical.field || !categorical.values) return fallbackColor;
  const expression = ['match', ['to-string', ['get', categorical.field]]];
  for (const [value, item] of Object.entries(categorical.values)) {
    expression.push(String(value), item.color);
  }
  expression.push(categorical.fallbackColor || fallbackColor);
  return expression;
}

function editRingFromGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  if (geometry.type === 'Polygon') return geometry.coordinates[0].map((point) => [point[0], point[1]]);
  if (geometry.type === 'MultiPolygon') {
    let best = null;
    let bestArea = -Infinity;
    for (const polygon of geometry.coordinates) {
      const ring = polygon && polygon[0];
      if (!ring || ring.length < 4) continue;
      const area = Math.abs(ringArea(ring));
      if (area > bestArea) {
        bestArea = area;
        best = ring.map((point) => [point[0], point[1]]);
      }
    }
    return best;
  }
  return null;
}

function editFeatureCollection(ring) {
  if (!ring || ring.length < 2) return { type: 'FeatureCollection', features: [] };
  const closed = ring.length >= 3 ? [...ring, ring[0]] : ring;
  const features = [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: closed } }];
  if (ring.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed] } });
  for (const point of ring.slice(0, -1)) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } });
  }
  return { type: 'FeatureCollection', features };
}

function labelTextExpression(label) {
  const field = ['to-string', ['get', label.field]];
  if (!label || !label.valueMap || Object.keys(label.valueMap).length === 0) return field;
  const expression = ['match', field];
  for (const [code, text] of Object.entries(label.valueMap)) {
    expression.push(String(code), String(text));
  }
  expression.push(label.fallback !== undefined ? String(label.fallback) : field);
  return expression;
}

function labelLayer(id, sourceId, label) {
  const layer = {
    id,
    type: 'symbol',
    source: sourceId,
    minzoom: label.minzoom !== undefined ? label.minzoom : 12,
    layout: {
      'text-field': labelTextExpression(label),
      'text-size': label.size !== undefined ? label.size : 12,
      'text-max-width': 8,
      'text-allow-overlap': Boolean(label.allowOverlap),
      'text-ignore-placement': false,
      'text-padding': 2,
    },
    paint: {
      'text-color': label.color || '#16423a',
      'text-halo-color': label.haloColor || 'rgba(255, 255, 255, 0.92)',
      'text-halo-width': label.haloWidth !== undefined ? label.haloWidth : 1.2,
    },
  };
  if (label.maxzoom !== undefined) layer.maxzoom = label.maxzoom;
  if (label.anchor) layer.layout['text-anchor'] = label.anchor;
  if (Array.isArray(label.font) && label.font.length > 0) layer.layout['text-font'] = label.font;
  return layer;
}

function emptyMapStyle(scheme) {
  const glyphs = typeof window !== 'undefined' && window.location && window.location.origin
    ? window.location.origin + MAP_GLYPHS_URL
    : MAP_GLYPHS_URL;
  return {
    version: 8,
    glyphs,
    sources: {},
    layers: [{
      id: 'gis-background',
      type: 'background',
      paint: { 'background-color': scheme === 'dark' ? '#121b1a' : '#e8ece4' },
    }],
  };
}

const zh = {
  'mode.enter': '进入 GIS 工作台',
  'mode.exit': '返回原版模式',
  'mode.workbench': 'GIS 工作台',
  'mode.badge': '工作台模式',
  'mode.framework': 'MapLibre GL JS 预览',
  'mode.original': '原版模式',
  'brand.sub': 'MapLibre GL JS · 对话驱动图层',
  'topbar.stats': '{layers} 个图层',
  'chat.tab': '地图会话',
  'chat.toggle': '对话面板',
  'chat.title': '地图对话',
  'chat.subtitle': '当前会话 · 地图交互',
  'chat.collapse': '收起对话面板',
  'chat.unavailable': '右侧对话暂不可用',
  'chat.noSession': '选择一个会话后即可开始对话',
  'layers.title': '图层',
  'layers.emptyTitle': '暂无图层',
  'layers.emptyBody': '从数据集添加图层，或在右侧对话中描述要添加的图层。',
  'layers.example': '打开顶部「数据集」注册文件或瓦片图层',
  'layers.raster': '栅格',
  'layers.show': '显示图层',
  'layers.hide': '隐藏图层',
  'layers.remove': '移除图层',
  'layers.project': '工程图层',
  'layers.session': '会话图层',
  'layers.unsupported': '不可渲染',
  'layers.noProject': '未选择工程',
  'layers.added': '图层已添加',
  'layers.saveToProject': '保存到工程',
  'layers.zoomTo': '定位到数据范围',
  'layers.addToChat': '添加到对话',
  'layers.newVector': '新建矢量图层',
  'layers.refresh': '刷新图层',
  'layers.editVector': '编辑多边形',
  'layers.appendVector': '追加多边形',
  'layers.editMode': '编辑多边形',
  'layers.editSelect': '点击一个多边形开始编辑',
  'layers.editHint': '拖动节点或拖动多边形内部，修改会自动保存',
  'layers.editClear': '取消选择',
  'layers.editExit': '退出编辑',
  'layers.featureUpdated': '要素已更新',
  'layers.featureUpdateFailed': '更新要素失败',
  'layers.deleteFeature': '删除该要素',
  'layers.featureDeleted': '要素已删除',
  'layers.featureDeleteFailed': '删除要素失败',
  'layers.polygon': '多边形',
  'layers.newVectorTitle': '新建矢量图层',
  'layers.vectorName': '图层名称',
  'layers.vectorHint': '创建后进入多边形绘制，左键加点，右键或“完成”闭合保存。',
  'layers.createVector': '创建并绘制',
  'layers.drawing': '绘制多边形',
  'layers.drawHint': '左键添加点，右键或“完成”闭合多边形',
  'layers.drawComplete': '完成',
  'layers.drawUndo': '撤销',
  'layers.drawCancel': '取消',
  'layers.drawMin': '至少需要 3 个点才能保存多边形',
  'layers.drawSaved': '多边形已保存',
  'layers.drawFailed': '保存多边形失败',
  'layers.drawPoints': '{count} 个点',
  'layers.addedToChat': '图层信息已加入对话输入框',
  'layers.chatUnavailable': '无法定位对话输入框，请先打开地图对话',
  'measure.distance': '距离',
  'measure.area': '面积',
  'measure.hint': '左键点击地图添加点，右键结束测量',
  'measure.finished': '测量已完成（右键结束）',
  'measure.finish': '完成',
  'measure.resume': '继续测量',
  'measure.empty': '还没有测量点',
  'measure.undo': '撤销',
  'measure.clear': '清空',
  'measure.points': '{count} 个点',
  'annotate.default': '标记',
  'annotate.hint': '点击地图添加标记',
  'annotate.empty': '还没有标记',
  'annotate.clear': '清空',
  'annotate.delete': '删除标记',
  'annotate.locate': '定位到标记',
  'annotate.name': '标记名称',
  'project.title': '工程',
  'project.select': '选择工程',
  'project.new': '新建工程',
  'project.namePlaceholder': '工程名称',
  'project.create': '创建',
  'project.cancel': '取消',
  'project.loading': '加载工程…',
  'project.none': '暂无工程',
  'project.created': '工程已创建',
  'project.failed': '工程操作失败',
  'project.save': '保存工程',
  'project.saving': '保存中…',
  'project.saved': '工程已保存',
  'project.saveFailed': '保存工程失败',
  'project.unsaved': '有未保存修改',
  'dataset.manage': '数据集',
  'dataset.title': '数据集管理',
  'dataset.tabList': '已有数据集',
  'dataset.tabBrowse': '服务器目录',
  'dataset.tabUpload': '上传文件',
  'dataset.tabUrl': '瓦片 URL',
  'dataset.tabDatabase': '数据库',
  'dataset.pgDatabase': 'pg数据库',
  'dataset.dbTitle': 'PostgreSQL / PostGIS',
  'dataset.dbHint': '注册 PostGIS 数据库，选择空间表导入当前工程 GPKG 并添加为图层。',
  'dataset.dbName': '连接名称',
  'dataset.dbHost': '主机',
  'dataset.dbPort': '端口',
  'dataset.dbDatabase': '数据库',
  'dataset.dbUser': '用户名',
  'dataset.dbPassword': '密码',
  'dataset.dbSsl': 'SSL 模式',
  'dataset.dbRegister': '注册数据库',
  'dataset.dbConnecting': '正在连接并读取表...',
  'dataset.dbRegistered': '数据库已注册',
  'dataset.dbNoTables': '该数据库中没有可用的 PostGIS 空间表',
  'dataset.dbTables': '空间表',
  'dataset.dbAddTable': '添加为图层',
  'dataset.dbImported': '数据表已导入并添加图层',
  'dataset.dbDelete': '删除连接',
  'dataset.dbSelect': '选择已注册数据库',
  'dataset.dbColumns': '{count} 个字段',
  'dataset.dbFailed': '数据库操作失败',
  'dataset.loading': '加载数据集…',
  'dataset.empty': '还没有数据集',
  'dataset.addLayer': '添加为图层',
  'dataset.convertCog': '转为 COG',
  'dataset.delete': '删除数据集',
  'dataset.deleteConfirm': '删除该数据集及其图层？',
  'dataset.register': '注册数据集',
  'dataset.upload': '上传并注册',
  'dataset.uploadHint': '支持 GeoJSON、CSV、GeoTIFF、图片和 Shapefile',
  'dataset.urlPlaceholder': 'https://…/{z}/{x}/{y}',
  'dataset.urlName': '图层名称',
  'dataset.addUrl': '添加瓦片数据集',
  'dataset.browsePath': '路径',
  'dataset.go': '前往',
  'dataset.up': '上级目录',
  'dataset.selectFile': '选择文件',
  'dataset.selected': '已选择',
  'dataset.noProject': '请先创建或选择一个工程',
  'dataset.registered': '数据集已注册',
  'dataset.uploadSuccess': '文件已上传并注册',
  'dataset.uploadSuccessCount': '已导入 {count} 个数据集并添加图层',
  'dataset.uploading': '正在上传…',
  'dataset.paused': '已暂停，可继续上传',
  'dataset.completing': '正在处理数据（导入矢量 / 转换栅格）…',
  'dataset.resume': '继续上传',
  'dataset.pause': '暂停',
  'dataset.uploadResumable': '分片上传 · 支持断点续传',
  'dataset.uploadProgress': '{percent}% · {uploaded} / {total}',
  'dataset.uploadFailed': '上传失败',
  'dataset.conversionFailed': 'COG 转换失败',
  'dataset.deleted': '数据集已删除',
  'dataset.layerAdded': '图层已添加',
  'dataset.failed': '数据集操作失败',
  'dataset.kind.vector': '矢量',
  'dataset.kind.raster': '栅格',
  'dataset.kind.table': '表',
  'dataset.features': '{count} 个要素',
  'dataset.rows': '{count} 行',
  'dataset.crs': 'CRS {crs}',
  'layers.count': '{count} 个图层',
  'tools.title': '工具',
  'tools.layers': '图层',
  'tools.measure': '测量',
  'tools.annotate': '标记',
  'tools.analyze': '空间分析',
  'tools.data': '数据',
  'tools.pending': '该工具将在后续版本接入',
  'map.title': 'GIS 地图视窗',
  'map.subtitleEmpty': '空图层 · 等待对话添加',
  'map.subtitleActive': '{count} 个图层 · 对话驱动',
  'map.aria': 'GIS 地图视窗，可拖拽平移、滚轮缩放',
  'map.reset': '重置视图',
  'map.zoomIn': '放大',
  'map.zoomOut': '缩小',
  'map.lon': '经度',
  'map.lat': '纬度',
  'map.zoom': '缩放',
  'map.hint': '拖拽平移 · 滚轮缩放 · 图层通过右侧对话添加',
  'map.attribution': '© MapLibre',
  'map.emptyTitle': '地图还没有图层',
  'map.emptyBody': '在右侧对话中说明要添加的图层，例如天地图影像。',
  'map.emptyPrompt': '添加天地图影像图层',
  'map.loading': '地图初始化中…',
  'map.failed': '地图初始化失败，请检查 WebGL 或网络',
  'gis.tool.title': '添加地图图层',
  'gis.tool.preparing': '准备中',
  'gis.tool.adding': '正在添加',
  'gis.tool.added': '已添加',
  'gis.tool.failed': '添加失败',
  'gis.tool.defaultName': '天地图影像',
  'gis.tool.viewMap': '查看地图',
  'gis.style.title': '地图样式',
  'gis.style.updating': '正在应用样式',
  'gis.style.updated': '样式已应用',
  'gis.style.failed': '样式应用失败',
  'gis.style.pendingHint': '等待后端校验并保存图层样式',
  'gis.style.errorFallback': '样式更新失败',
  'gis.style.savedOnly': '样式已保存；当前地图未加载该图层',
  'gis.tool.remove': '从地图移除',
  'gis.tool.pendingHint': '图层会在结果返回后加入地图',
  'gis.tool.errorFallback': '图层参数无效，请重试。',
  'gis.view.title': '地图视野',
  'gis.view.locating': '正在定位',
  'gis.view.located': '已定位',
  'gis.view.failed': '定位失败',
  'gis.view.defaultLabel': '目标区域',
  'gis.view.pendingHint': '视野会在结果返回后移动',
  'gis.view.errorFallback': '视野参数无效，请重试。',
};

const en = {
  'mode.enter': 'Open the GIS workbench',
  'mode.exit': 'Return to the standard layout',
  'mode.workbench': 'GIS workbench',
  'mode.badge': 'Workbench mode',
  'mode.framework': 'MapLibre GL JS preview',
  'mode.original': 'Standard layout',
  'brand.sub': 'MapLibre GL JS · conversation-driven layers',
  'topbar.stats': '{layers} layers',
  'chat.tab': 'Map session',
  'chat.toggle': 'Conversation',
  'chat.title': 'Map chat',
  'chat.subtitle': 'Current session · map controls',
  'chat.collapse': 'Collapse the conversation panel',
  'chat.unavailable': 'The conversation panel is unavailable',
  'chat.noSession': 'Select a session to start a conversation',
  'layers.title': 'Layers',
  'layers.emptyTitle': 'No layers yet',
  'layers.emptyBody': 'Add layers from datasets, or describe a layer in the conversation.',
  'layers.example': 'Open Datasets to register a file or tile layer',
  'layers.raster': 'Raster',
  'layers.show': 'Show layer',
  'layers.hide': 'Hide layer',
  'layers.remove': 'Remove layer',
  'layers.project': 'Project layers',
  'layers.session': 'Session layer',
  'layers.unsupported': 'Not renderable',
  'layers.noProject': 'No project selected',
  'layers.added': 'Layer added',
  'layers.saveToProject': 'Save to project',
  'layers.zoomTo': 'Zoom to data extent',
  'layers.addToChat': 'Add to conversation',
  'layers.newVector': 'New vector layer',
  'layers.refresh': 'Refresh layers',
  'layers.editVector': 'Edit polygon',
  'layers.appendVector': 'Append polygon',
  'layers.editMode': 'Edit polygon',
  'layers.editSelect': 'Click a polygon to start editing',
  'layers.editHint': 'Drag a vertex or drag inside the polygon; changes save automatically',
  'layers.editClear': 'Clear selection',
  'layers.editExit': 'Exit edit',
  'layers.featureUpdated': 'Feature updated',
  'layers.featureUpdateFailed': 'Could not update feature',
  'layers.deleteFeature': 'Delete feature',
  'layers.featureDeleted': 'Feature deleted',
  'layers.featureDeleteFailed': 'Could not delete feature',
  'layers.polygon': 'Polygon',
  'layers.newVectorTitle': 'New vector layer',
  'layers.vectorName': 'Layer name',
  'layers.vectorHint': 'After creation, draw a polygon: left-click points, right-click or Finish to close and save.',
  'layers.createVector': 'Create and draw',
  'layers.drawing': 'Draw polygon',
  'layers.drawHint': 'Left-click points; right-click or Finish to close the polygon',
  'layers.drawComplete': 'Finish',
  'layers.drawUndo': 'Undo',
  'layers.drawCancel': 'Cancel',
  'layers.drawMin': 'At least three points are required',
  'layers.drawSaved': 'Polygon saved',
  'layers.drawFailed': 'Could not save polygon',
  'layers.drawPoints': '{count} points',
  'layers.addedToChat': 'Layer context added to the conversation composer',
  'layers.chatUnavailable': 'Could not find the conversation composer; open the map chat first',
  'measure.distance': 'Distance',
  'measure.area': 'Area',
  'measure.hint': 'Left-click to add points; right-click to finish',
  'measure.finished': 'Measurement finished (right-click)',
  'measure.finish': 'Finish',
  'measure.resume': 'Resume measuring',
  'measure.empty': 'No measurement points yet',
  'measure.undo': 'Undo',
  'measure.clear': 'Clear',
  'measure.points': '{count} points',
  'annotate.default': 'Mark',
  'annotate.hint': 'Click the map to add a marker',
  'annotate.empty': 'No markers yet',
  'annotate.clear': 'Clear',
  'annotate.delete': 'Delete marker',
  'annotate.locate': 'Center on marker',
  'annotate.name': 'Marker name',
  'project.title': 'Project',
  'project.select': 'Select project',
  'project.new': 'New project',
  'project.namePlaceholder': 'Project name',
  'project.create': 'Create',
  'project.cancel': 'Cancel',
  'project.loading': 'Loading projects…',
  'project.none': 'No projects',
  'project.created': 'Project created',
  'project.failed': 'Project operation failed',
  'project.save': 'Save project',
  'project.saving': 'Saving…',
  'project.saved': 'Project saved',
  'project.saveFailed': 'Could not save project',
  'project.unsaved': 'Unsaved changes',
  'dataset.manage': 'Datasets',
  'dataset.title': 'Dataset manager',
  'dataset.tabList': 'Datasets',
  'dataset.tabBrowse': 'Server directory',
  'dataset.tabUpload': 'Upload file',
  'dataset.tabUrl': 'Tile URL',
  'dataset.tabDatabase': 'Database',
  'dataset.pgDatabase': 'PostgreSQL',
  'dataset.dbTitle': 'PostgreSQL / PostGIS',
  'dataset.dbHint': 'Register a PostGIS database, import a spatial table into the project GeoPackage, and add it as a layer.',
  'dataset.dbName': 'Connection name',
  'dataset.dbHost': 'Host',
  'dataset.dbPort': 'Port',
  'dataset.dbDatabase': 'Database',
  'dataset.dbUser': 'Username',
  'dataset.dbPassword': 'Password',
  'dataset.dbSsl': 'SSL mode',
  'dataset.dbRegister': 'Register database',
  'dataset.dbConnecting': 'Connecting and reading tables...',
  'dataset.dbRegistered': 'Database registered',
  'dataset.dbNoTables': 'No PostGIS spatial tables found in this database',
  'dataset.dbTables': 'Spatial tables',
  'dataset.dbAddTable': 'Add as layer',
  'dataset.dbImported': 'Table imported and added as a layer',
  'dataset.dbDelete': 'Delete connection',
  'dataset.dbSelect': 'Select a registered database',
  'dataset.dbColumns': '{count} columns',
  'dataset.dbFailed': 'Database operation failed',
  'dataset.loading': 'Loading datasets…',
  'dataset.empty': 'No datasets yet',
  'dataset.addLayer': 'Add as layer',
  'dataset.convertCog': 'Convert to COG',
  'dataset.delete': 'Delete dataset',
  'dataset.deleteConfirm': 'Delete this dataset and its layers?',
  'dataset.register': 'Register dataset',
  'dataset.upload': 'Upload and register',
  'dataset.uploadHint': 'GeoJSON, CSV, GeoTIFF, images, and Shapefile',
  'dataset.urlPlaceholder': 'https://…/{z}/{x}/{y}',
  'dataset.urlName': 'Layer name',
  'dataset.addUrl': 'Add tile dataset',
  'dataset.browsePath': 'Path',
  'dataset.go': 'Go',
  'dataset.up': 'Parent directory',
  'dataset.selectFile': 'Select file',
  'dataset.selected': 'Selected',
  'dataset.noProject': 'Create or select a project first',
  'dataset.registered': 'Dataset registered',
  'dataset.uploadSuccess': 'File uploaded and registered',
  'dataset.uploadSuccessCount': 'Imported {count} datasets and added layers',
  'dataset.uploading': 'Uploading…',
  'dataset.paused': 'Paused — upload can resume',
  'dataset.completing': 'Processing data (vector import / raster conversion)…',
  'dataset.resume': 'Resume upload',
  'dataset.pause': 'Pause',
  'dataset.uploadResumable': 'Chunked upload · resumable',
  'dataset.uploadProgress': '{percent}% · {uploaded} / {total}',
  'dataset.uploadFailed': 'Upload failed',
  'dataset.conversionFailed': 'COG conversion failed',
  'dataset.deleted': 'Dataset deleted',
  'dataset.layerAdded': 'Layer added',
  'dataset.failed': 'Dataset operation failed',
  'dataset.kind.vector': 'Vector',
  'dataset.kind.raster': 'Raster',
  'dataset.kind.table': 'Table',
  'dataset.features': '{count} features',
  'dataset.rows': '{count} rows',
  'dataset.crs': 'CRS {crs}',
  'layers.count': '{count} layers',
  'tools.title': 'Tools',
  'tools.layers': 'Layers',
  'tools.measure': 'Measure',
  'tools.annotate': 'Annotate',
  'tools.analyze': 'Spatial analysis',
  'tools.data': 'Data',
  'tools.pending': 'This tool arrives in a later iteration',
  'map.title': 'GIS map view',
  'map.subtitleEmpty': 'Empty layers · waiting for a conversation',
  'map.subtitleActive': '{count} layers · conversation-driven',
  'map.aria': 'GIS map view. Drag to pan and scroll to zoom.',
  'map.reset': 'Reset view',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  'map.lon': 'Lon',
  'map.lat': 'Lat',
  'map.zoom': 'Zoom',
  'map.hint': 'Drag to pan · scroll to zoom · add layers from the conversation on the right',
  'map.attribution': '© MapLibre',
  'map.emptyTitle': 'The map has no layers yet',
  'map.emptyBody': 'Describe a layer in the conversation on the right, for example Tianditu imagery.',
  'map.emptyPrompt': 'Add the Tianditu image layer',
  'map.loading': 'Initializing the map…',
  'map.failed': 'The map could not start. Check WebGL and network access.',
  'gis.tool.title': 'Add map layer',
  'gis.tool.preparing': 'Preparing',
  'gis.tool.adding': 'Adding',
  'gis.tool.added': 'Added',
  'gis.tool.failed': 'Failed',
  'gis.tool.defaultName': 'Tianditu imagery',
  'gis.tool.viewMap': 'View map',
  'gis.style.title': 'Map style',
  'gis.style.updating': 'Applying style',
  'gis.style.updated': 'Style applied',
  'gis.style.failed': 'Style update failed',
  'gis.style.pendingHint': 'Waiting for the backend to validate and persist the layer style',
  'gis.style.errorFallback': 'Style update failed',
  'gis.style.savedOnly': 'Style saved; the layer is not loaded in the current map',
  'gis.tool.remove': 'Remove from map',
  'gis.tool.pendingHint': 'The layer joins the map after the result settles',
  'gis.tool.errorFallback': 'The layer parameters were invalid. Please try again.',
  'gis.view.title': 'Map view',
  'gis.view.locating': 'Locating',
  'gis.view.located': 'Located',
  'gis.view.failed': 'Failed',
  'gis.view.defaultLabel': 'Target area',
  'gis.view.pendingHint': 'The camera moves once the result settles',
  'gis.view.errorFallback': 'The view parameters were invalid. Please try again.',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function SvgIcon({ name, size = 16, strokeWidth = 1.6 }) {
  const base = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  };
  if (name === 'map') {
    return h('svg', base,
      h('path', { d: 'M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z' }),
      h('path', { d: 'M9 3v15M15 6v15' }),
    );
  }
  if (name === 'layers') {
    return h('svg', base,
      h('path', { d: 'm12 3-9 5 9 5 9-5-9-5Z' }),
      h('path', { d: 'm3 12 9 5 9-5M3 16l9 5 9-5' }),
    );
  }
  if (name === 'image') {
    return h('svg', base,
      h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
      h('circle', { cx: 8.5, cy: 9, r: 1.5 }),
      h('path', { d: 'm21 16-5.5-5L7 20' }),
    );
  }
  if (name === 'eye') {
    return h('svg', base,
      h('path', { d: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z' }),
      h('circle', { cx: 12, cy: 12, r: 2.5 }),
    );
  }
  if (name === 'eye-off') {
    return h('svg', base,
      h('path', { d: 'M3 3l18 18' }),
      h('path', { d: 'M10.6 6.2A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.2 3.1M6.3 7.5A17 17 0 0 0 2.5 12s3.5 6 9.5 6a10.8 10.8 0 0 0 4.2-.8' }),
      h('path', { d: 'M9.9 9.9A3 3 0 0 0 14.1 14' }),
    );
  }
  if (name === 'trash') {
    return h('svg', base,
      h('path', { d: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6' }),
    );
  }
  if (name === 'ruler') {
    return h('svg', base,
      h('path', { d: 'M3 17 17 3l4 4L7 21l-4-4Z' }),
      h('path', { d: 'm7 13 2 2M10 10l2 2M13 7l2 2' }),
    );
  }
  if (name === 'pin') {
    return h('svg', base,
      h('path', { d: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z' }),
      h('circle', { cx: 12, cy: 10, r: 2.5 }),
    );
  }
  if (name === 'chart') {
    return h('svg', base,
      h('path', { d: 'M4 20V10M10 20V4M16 20v-7M22 20V8' }),
      h('path', { d: 'M2 20h20' }),
    );
  }
  if (name === 'folder') {
    return h('svg', base,
      h('path', { d: 'M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z' }),
    );
  }
  if (name === 'file') {
    return h('svg', base,
      h('path', { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z' }),
      h('path', { d: 'M14 3v6h6' }),
    );
  }
  if (name === 'locate') {
    return h('svg', base,
      h('circle', { cx: 12, cy: 12, r: 6.5 }),
      h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3' }),
      h('circle', { cx: 12, cy: 12, r: 1.5, fill: 'currentColor', stroke: 'none' }),
    );
  }
  if (name === 'refresh') {
    return h('svg', base,
      h('path', { d: 'M20 11a8 8 0 0 0-14.8-3.5L3 10' }),
      h('path', { d: 'M3 5v5h5' }),
      h('path', { d: 'M4 13a8 8 0 0 0 14.8 3.5L21 14' }),
      h('path', { d: 'M21 19v-5h-5' }),
    );
  }
  if (name === 'pencil') {
    return h('svg', base,
      h('path', { d: 'M4 20l4-1L19 8l-3-3L5 16l-1 4Z' }),
      h('path', { d: 'M14 5l3 3' }),
    );
  }
  if (name === 'save') {
    return h('svg', base,
      h('path', { d: 'M5 3h11l3 3v15H5V3Z' }),
      h('path', { d: 'M8 3v6h8V3M8 14h8v6H8z' }),
    );
  }
  if (name === 'upload') {
    return h('svg', base,
      h('path', { d: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4' }),
    );
  }
  if (name === 'chevron-left') {
    return h('svg', base, h('path', { d: 'm15 6-6 6 6 6' }));
  }
  if (name === 'database') {
    return h('svg', base,
      h('ellipse', { cx: 12, cy: 5.5, rx: 7.5, ry: 3 }),
      h('path', { d: 'M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6' }),
      h('path', { d: 'M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6' }),
    );
  }
  if (name === 'chat') {
    return h('svg', base,
      h('path', { d: 'M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10Z' }),
      h('path', { d: 'M8 9h8M8 13h5' }),
    );
  }
  if (name === 'layout') {
    return h('svg', base,
      h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
      h('path', { d: 'M9 4v16M9 11h12' }),
    );
  }
  if (name === 'chevron-right') {
    return h('svg', base, h('path', { d: 'm9 6 6 6-6 6' }));
  }
  if (name === 'plus') {
    return h('svg', base, h('path', { d: 'M12 5v14M5 12h14' }));
  }
  if (name === 'minus') {
    return h('svg', base, h('path', { d: 'M5 12h14' }));
  }
  if (name === 'reset') {
    return h('svg', base,
      h('path', { d: 'M3 12a9 9 0 1 0 3-6.7' }),
      h('path', { d: 'M3 4v5h5' }),
    );
  }
  if (name === 'close') {
    return h('svg', base, h('path', { d: 'M6 6l12 12M18 6 6 18' }));
  }
  if (name === 'warning') {
    return h('svg', base,
      h('path', { d: 'M12 3 2.5 20h19L12 3Z' }),
      h('path', { d: 'M12 9v5M12 17.5v.01' }),
    );
  }
  return h('svg', base, h('circle', { cx: 12, cy: 12, r: 8 }));
}

function useLayerStore() {
  const [snapshot, setSnapshot] = useState(getLayers);
  useEffect(() => subscribe(() => setSnapshot(getLayers())), []);
  return snapshot;
}

function useViewStore() {
  const [snapshot, setSnapshot] = useState(getView);
  useEffect(() => subscribe(() => setSnapshot(getView())), []);
  return snapshot;
}

function useScheme(runtime) {
  const read = useCallback(() => {
    try {
      const snapshot = runtime.theme.getTheme();
      return snapshot && snapshot.active && snapshot.active.colorScheme === 'dark' ? 'dark' : 'light';
    } catch (error) {
      return 'light';
    }
  }, [runtime]);
  const [scheme, setScheme] = useState(read);
  useEffect(() => runtime.on('theme/change', () => setScheme(read())), [runtime, read]);
  return scheme;
}

function setWorkbenchOpen(value) {
  if (workbenchOpen === value) return;
  workbenchOpen = value;
  for (const listener of [...workbenchListeners]) listener();
}

function useWorkbenchOpen() {
  const [open, setOpen] = useState(workbenchOpen);
  useEffect(() => {
    const listener = () => setOpen(workbenchOpen);
    workbenchListeners.add(listener);
    return () => {
      workbenchListeners.delete(listener);
    };
  }, []);
  return open;
}

function GisStyle({ withMap = false }) {
  return h('style', { 'data-gis-workbench': 'styles' }, withMap ? maplibreCss + '\n' + BASE_CSS : BASE_CSS);
}

function MapCanvas({ runtime, t, activeTool, onToggleLayer, onRemoveLayer, onSaveLayer, onReorderLayers, onNotify, onLayerMenu, onFeatureMenu, drawTarget, onSavePolygon, onCancelDraw, onNewVectorLayer, onEditLayer, onAppendLayer, onRefreshLayers, editTarget, onUpdateFeature, onCancelEdit, projectName }) {
  const scheme = useScheme(runtime);
  const layers = useLayerStore();
  const view = useViewStore();
  const appliedViewRef = useRef(0);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const knownRef = useRef(new Map());
  const fittedRef = useRef(new Set());
  const labelLoadsRef = useRef(new Map());
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [position, setPosition] = useState(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [measureMode, setMeasureMode] = useState('distance');
  const [measurePoints, setMeasurePoints] = useState([]);
  const [measureFinished, setMeasureFinished] = useState(false);
  const [measureHover, setMeasureHover] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [drawPoints, setDrawPoints] = useState([]);
  const [drawSaving, setDrawSaving] = useState(false);
  const [editFeature, setEditFeature] = useState(null);
  const editFeatureRef = useRef(null);
  const editMarkersRef = useRef([]);
  const editDragRef = useRef(null);
  const hoverStampRef = useRef(0);
  const measureSourceId = 'gis-measure-source';
  const markersRef = useRef(new Map());
  const annotationSeqRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return undefined;
    let map;
    try {
      if (maplibregl.supported && !maplibregl.supported()) {
        setMapError(t('map.failed'));
        return undefined;
      }
      map = new maplibregl.Map({
        container,
        style: emptyMapStyle(scheme),
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        minZoom: 1,
        maxZoom: 22,
        localIdeographFontFamily: 'sans-serif',
        attributionControl: false,
        logoPosition: 'bottom-left',
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 120,
        antialias: true,
      });
    } catch (error) {
      console.error('[gis-workbench] map initialization failed', error);
      setMapError(t('map.failed'));
      return undefined;
    }
    mapRef.current = map;
    map.on('load', () => setReady(true));
    map.on('style.load', () => setReady(true));
    map.on('mousemove', (event) => {
      if (event && event.lngLat) setPosition({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    });
    map.on('zoom', () => setZoom(map.getZoom()));
    map.on('mouseout', () => setPosition(null));
    map.on('error', (event) => {
      console.warn('[gis-workbench] map error', event && event.error ? event.error : event);
    });
    try {
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 88, unit: 'metric' }), 'bottom-left');
    } catch (error) {
      console.warn('[gis-workbench] scale control unavailable', error);
    }
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        try {
          map.resize();
        } catch (error) {
          // The map may already be removing.
        }
      });
      observer.observe(container);
    }
    return () => {
      if (observer) observer.disconnect();
      mapRef.current = null;
      knownRef.current = new Map();
      try {
        map.remove();
      } catch (error) {
        // Removal is best effort after a failed initialization.
      }
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      map.setPaintProperty('gis-background', 'background-color', scheme === 'dark' ? '#121b1a' : '#e8ece4');
    } catch (error) {
      console.warn('[gis-workbench] could not update the map background', error);
    }
  }, [scheme, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const desired = new Map();
    const styleColor = (layer) => {
      const style = layer.style && typeof layer.style === 'object' ? layer.style : {};
      return style.color || style['fill-color'] || '#2f7d6d';
    };
    const setVisible = (layer, ids) => {
      for (const id of ids) {
        try {
          map.setLayoutProperty(id, 'visibility', layer.visible ? 'visible' : 'none');
        } catch (error) {
          // A layer that failed to add is skipped.
        }
      }
    };

    for (const layer of layers) {
      const base = layer.id;
      try {
        if ((layer.renderKind === 'raster-tiles' || (layer.tileUrl && !layer.renderKind)) && layer.tileUrl) {
          const sourceId = base + '-src';
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
              type: 'raster',
              tiles: [resolveTileUrl(layer.tileUrl)],
              tileSize: layer.tileSize || 256,
              minzoom: layer.minzoom ?? 0,
              maxzoom: layer.maxzoom ?? 18,
              scheme: 'xyz',
              attribution: layer.attribution || '',
            });
          }
          if (!map.getLayer(base)) {
            map.addLayer({
              id: base,
              type: 'raster',
              source: sourceId,
              paint: {
                'raster-opacity': layer.style && layer.style.opacity !== undefined ? layer.style.opacity : 1,
                'raster-fade-duration': 120,
              },
            });
          }
          setVisible(layer, [base]);
          desired.set(base, { sourceId, layerIds: [base] });
          continue;
        }

        if (layer.renderKind === 'geojson' && layer.url) {
          const sourceId = base + '-src';
          const previous = knownRef.current.get(base);
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, { type: 'geojson', data: layer.url });
          } else if (previous && previous.url !== layer.url) {
            const source = map.getSource(sourceId);
            if (source && typeof source.setData === 'function') source.setData(layer.url);
          }
          const style = layer.style && typeof layer.style === 'object' ? layer.style : {};
          const color = style.fillColor || style.lineColor || style.circleColor || style.color || '#2f7d6d';
          const fillOpacity = style.fillOpacity !== undefined ? style.fillOpacity : (style.opacity !== undefined ? style.opacity : 0.16);
          const lineOpacity = style.lineOpacity !== undefined ? style.lineOpacity : (style.opacity !== undefined ? style.opacity : 0.9);
          const circleOpacity = style.circleOpacity !== undefined ? style.circleOpacity : (style.opacity !== undefined ? style.opacity : 1);
          const fillColor = categoricalFillExpression(style.categorical, color);
          const ids = [base + '-fill', base + '-line', base + '-circle'];
          if (!map.getLayer(ids[0])) {
            map.addLayer({ id: ids[0], type: 'fill', source: sourceId, paint: { 'fill-color': fillColor, 'fill-opacity': fillOpacity } });
          } else {
            map.setPaintProperty(ids[0], 'fill-color', fillColor);
            map.setPaintProperty(ids[0], 'fill-opacity', fillOpacity);
          }
          if (!map.getLayer(ids[1])) {
            map.addLayer({ id: ids[1], type: 'line', source: sourceId, paint: { 'line-color': style.lineColor || color, 'line-width': style.lineWidth !== undefined ? style.lineWidth : 1.4, 'line-opacity': lineOpacity } });
          } else {
            map.setPaintProperty(ids[1], 'line-color', style.lineColor || color);
            map.setPaintProperty(ids[1], 'line-width', style.lineWidth !== undefined ? style.lineWidth : 1.4);
            map.setPaintProperty(ids[1], 'line-opacity', lineOpacity);
          }
          if (!map.getLayer(ids[2])) {
            map.addLayer({ id: ids[2], type: 'circle', source: sourceId, paint: { 'circle-color': style.circleColor || color, 'circle-radius': style.circleRadius !== undefined ? style.circleRadius : 3.5, 'circle-opacity': circleOpacity, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } });
          } else {
            map.setPaintProperty(ids[2], 'circle-color', style.circleColor || color);
            map.setPaintProperty(ids[2], 'circle-radius', style.circleRadius !== undefined ? style.circleRadius : 3.5);
            map.setPaintProperty(ids[2], 'circle-opacity', circleOpacity);
          }
          const label = style.label && style.label.field ? style.label : null;
          const labelId = base + '-label';
          const labelSourceId = base + '-label-src';
          if (label) {
            const onePerFeature = Boolean(label.onePerFeature);
            const labelSource = onePerFeature ? labelSourceId : sourceId;
            if (onePerFeature) {
              if (!map.getSource(labelSourceId)) {
                map.addSource(labelSourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
              }
              if (labelLoadsRef.current.get(labelSourceId) !== layer.url) {
                labelLoadsRef.current.set(labelSourceId, layer.url);
                fetch(layer.url, { credentials: 'same-origin' })
                  .then((response) => {
                    if (!response.ok) throw new Error('Label source HTTP ' + response.status);
                    return response.json();
                  })
                  .then((data) => {
                    const features = data && data.type === 'Feature' ? [data] : (data && Array.isArray(data.features) ? data.features : []);
                    const points = [];
                    for (const feature of features) {
                      const point = geometryLabelPoint(feature && feature.geometry);
                      if (!point) continue;
                      points.push({
                        type: 'Feature',
                        properties: feature.properties || {},
                        geometry: { type: 'Point', coordinates: point },
                      });
                    }
                    const source = mapRef.current && mapRef.current.getSource(labelSourceId);
                    if (source) source.setData({ type: 'FeatureCollection', features: points });
                  })
                  .catch((error) => {
                    labelLoadsRef.current.delete(labelSourceId);
                    console.warn('[gis-workbench] could not build one-per-feature label points', error);
                  });
              }
            } else if (map.getSource(labelSourceId)) {
              if (map.getLayer(labelId)) map.removeLayer(labelId);
              map.removeSource(labelSourceId);
              labelLoadsRef.current.delete(labelSourceId);
            }
            if (map.getLayer(labelId) && map.getLayer(labelId).source !== labelSource) {
              map.removeLayer(labelId);
            }
            if (!map.getLayer(labelId)) {
              map.addLayer(labelLayer(labelId, labelSource, label));
            } else {
              map.setLayoutProperty(labelId, 'text-field', labelTextExpression(label));
              map.setLayoutProperty(labelId, 'text-size', label.size !== undefined ? label.size : 12);
              map.setLayoutProperty(labelId, 'text-allow-overlap', Boolean(label.allowOverlap));
              if (label.anchor) map.setLayoutProperty(labelId, 'text-anchor', label.anchor);
              if (Array.isArray(label.font) && label.font.length > 0) map.setLayoutProperty(labelId, 'text-font', label.font);
              map.setPaintProperty(labelId, 'text-color', label.color || '#16423a');
              map.setPaintProperty(labelId, 'text-halo-color', label.haloColor || 'rgba(255, 255, 255, 0.92)');
              map.setPaintProperty(labelId, 'text-halo-width', label.haloWidth !== undefined ? label.haloWidth : 1.2);
              map.setLayerZoomRange(labelId, label.minzoom !== undefined ? label.minzoom : 12, label.maxzoom !== undefined ? label.maxzoom : 24);
            }
            ids.push(labelId);
          } else {
            if (map.getLayer(labelId)) map.removeLayer(labelId);
            if (map.getSource(labelSourceId)) {
              map.removeSource(labelSourceId);
              labelLoadsRef.current.delete(labelSourceId);
            }
          }
          setVisible(layer, ids);
          try {
            map.setLayoutProperty(ids[1], 'visibility', layer.visible && style.lineVisible !== false ? 'visible' : 'none');
            map.setLayoutProperty(ids[2], 'visibility', layer.visible && style.circleVisible !== false ? 'visible' : 'none');
          } catch (error) {
            // The component layer may be absent on an older map instance.
          }
          desired.set(base, { sourceId, layerIds: ids, url: layer.url });
          continue;
        }

        if (layer.renderKind === 'image' && layer.url && Array.isArray(layer.bbox) && layer.bbox.length === 4) {
          const sourceId = base + '-src';
          const [west, south, east, north] = layer.bbox;
          if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
              type: 'image',
              url: layer.url,
              coordinates: [[west, north], [east, north], [east, south], [west, south]],
            });
          }
          if (!map.getLayer(base)) {
            map.addLayer({
              id: base,
              type: 'raster',
              source: sourceId,
              paint: { 'raster-opacity': layer.style && layer.style.opacity !== undefined ? layer.style.opacity : 1 },
            });
          }
          setVisible(layer, [base]);
          desired.set(base, { sourceId, layerIds: [base] });
        }
      } catch (error) {
        console.warn('[gis-workbench] could not add the map layer', error);
      }
    }

    for (const [id, info] of knownRef.current) {
      if (desired.has(id)) continue;
      try {
        for (const layerId of info.layerIds) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        }
        if (map.getSource(info.sourceId)) map.removeSource(info.sourceId);
        if (map.getSource(id + '-label-src')) map.removeSource(id + '-label-src');
        labelLoadsRef.current.delete(id + '-label-src');
      } catch (error) {
        console.warn('[gis-workbench] could not remove the map layer', error);
      }
    }
    knownRef.current = desired;

    for (const layer of layers) {
      const info = desired.get(layer.id);
      if (!info) continue;
      for (const layerId of info.layerIds) {
        if (!map.getLayer(layerId)) continue;
        try {
          map.moveLayer(layerId);
        } catch (error) {
          // A layer that failed to add is skipped.
        }
      }
    }

    const pending = layers.filter((layer) => Array.isArray(layer.bbox) && layer.bbox.length === 4 && layer.renderKind !== 'unsupported' && !fittedRef.current.has(layer.id));
    if (pending.length > 0) {
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const layer of pending) {
        const [w, s, e, n] = layer.bbox.map(Number);
        if (![w, s, e, n].every(Number.isFinite)) continue;
        west = Math.min(west, w);
        south = Math.min(south, s);
        east = Math.max(east, e);
        north = Math.max(north, n);
      }
      if (Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)) {
        try {
          map.fitBounds([[west, south], [east, north]], { padding: 70, maxZoom: 20, duration: 0 });
          for (const layer of pending) fittedRef.current.add(layer.id);
        } catch (error) {
          console.warn('[gis-workbench] could not fit the map to the dataset bounds', error);
        }
      }
    }
  }, [layers, ready]);

  const finishDraw = useCallback(async () => {
    if (!drawTarget || drawSaving) return;
    if (drawPoints.length < 3) {
      if (onNotify) onNotify(t('layers.drawMin'));
      return;
    }
    const ring = [...drawPoints, drawPoints[0]];
    setDrawSaving(true);
    try {
      await onSavePolygon(drawTarget, { type: 'Polygon', coordinates: [ring] });
      setDrawPoints([]);
    } catch (error) {
      if (onNotify) onNotify(error instanceof Error ? error.message : t('layers.drawFailed'));
    } finally {
      setDrawSaving(false);
    }
  }, [drawTarget, drawPoints, drawSaving, onSavePolygon, onNotify, t]);

  const cancelDraw = useCallback(() => {
    setDrawPoints([]);
    if (onCancelDraw) onCancelDraw();
  }, [onCancelDraw]);

  const saveEditGeometry = useCallback(async () => {
    const feature = editFeatureRef.current;
    if (!editTarget || !feature || !Array.isArray(feature.ring) || feature.ring.length < 3) return;
    try {
      await onUpdateFeature(editTarget, feature, feature.ring);
    } catch (error) {
      if (onNotify) onNotify(error instanceof Error ? error.message : t('layers.featureUpdateFailed'));
    }
  }, [editTarget, onUpdateFeature, onNotify, t]);

  useEffect(() => {
    editFeatureRef.current = editFeature;
  }, [editFeature]);

  const locateLayer = (layer) => {
    const map = mapRef.current;
    if (!map || !layer || !Array.isArray(layer.bbox) || layer.bbox.length !== 4) return;
    const [west, south, east, north] = layer.bbox.map(Number);
    if (![west, south, east, north].every(Number.isFinite) || west === east || south === north) return;
    try {
      map.fitBounds([[west, south], [east, north]], { padding: 70, maxZoom: 20, duration: 800 });
    } catch (error) {
      console.warn('[gis-workbench] could not locate the layer extent', error);
    }
  };

  const zoomBy = (factor) => {
    const map = mapRef.current;
    if (!map) return;
    if (factor > 1) map.zoomIn();
    else map.zoomOut();
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !view) return;
    if (appliedViewRef.current === view.token) return;
    appliedViewRef.current = view.token;
    try {
      map.flyTo({
        center: view.center,
        zoom: view.zoom,
        bearing: 0,
        pitch: 0,
        duration: 1400,
        essential: true,
      });
    } catch (error) {
      console.warn('[gis-workbench] could not move the map view', error);
    }
  }, [view, ready]);

  const resetView = () => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, bearing: 0, pitch: 0 });
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    if (!map.getSource(measureSourceId)) {
      map.addSource(measureSourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'gis-measure-fill',
        type: 'fill',
        source: measureSourceId,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#2f7d6d', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'gis-measure-line',
        type: 'line',
        source: measureSourceId,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#2f7d6d', 'line-width': 2, 'line-dasharray': [2, 1] },
      });
      map.addLayer({
        id: 'gis-measure-points',
        type: 'circle',
        source: measureSourceId,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#2f7d6d',
          'circle-stroke-width': 2,
        },
      });
      map.addSource('gis-measure-rubber-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'gis-measure-rubber-fill',
        type: 'fill',
        source: 'gis-measure-rubber-source',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#e8843f', 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'gis-measure-rubber-line',
        type: 'line',
        source: 'gis-measure-rubber-source',
        paint: {
          'line-color': '#e8843f',
          'line-width': 1.6,
          'line-dasharray': [4, 3],
        },
      });
    }
    return () => {
      try {
        for (const layerId of ['gis-measure-rubber-line', 'gis-measure-rubber-fill', 'gis-measure-points', 'gis-measure-line', 'gis-measure-fill']) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        }
        if (map.getSource('gis-measure-rubber-source')) map.removeSource('gis-measure-rubber-source');
        if (map.getSource(measureSourceId)) map.removeSource(measureSourceId);
      } catch (error) {
        // The map may already be removed during overlay teardown.
      }
    };
  }, [ready, measureSourceId]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map && map.getSource(measureSourceId);
    if (!source || !ready) return;
    source.setData(measurementFeatureCollection(measurePoints, measureMode));
    for (const layerId of ['gis-measure-fill', 'gis-measure-line', 'gis-measure-points', 'gis-measure-rubber-fill', 'gis-measure-rubber-line']) {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    }
  }, [measurePoints, measureMode, ready, measureSourceId]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map && map.getSource('gis-measure-rubber-source');
    if (!source || !ready) return undefined;
    const clear = () => {
      source.setData({ type: 'FeatureCollection', features: [] });
      setMeasureHover(null);
    };
    if (activeTool !== 'measure' || measureFinished || measurePoints.length === 0) {
      clear();
      return undefined;
    }
    const last = measurePoints[measurePoints.length - 1];
    const onMove = (event) => {
      if (!event || !event.lngLat) return;
      const next = [event.lngLat.lng, event.lngLat.lat];
      const ring = measureMode === 'area' && measurePoints.length >= 2
        ? [...measurePoints, next, measurePoints[0]]
        : null;
      const features = [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: ring || [last, next] },
      }];
      if (ring) {
        features.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
      source.setData({ type: 'FeatureCollection', features });
      const now = Date.now();
      if (now - hoverStampRef.current >= 40) {
        hoverStampRef.current = now;
        setMeasureHover(next);
      }
    };
    const onOut = () => clear();
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      clear();
    };
  }, [activeTool, measureFinished, measureMode, measurePoints, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const layerId of ['gis-measure-fill', 'gis-measure-line', 'gis-measure-points', 'gis-measure-rubber-fill', 'gis-measure-rubber-line']) {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    }
  }, [layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || drawTarget || editTarget) return undefined;
    if (activeTool !== 'measure' && activeTool !== 'annotate') return undefined;
    const onClick = (event) => {
      const lng = event.lngLat.lng;
      const lat = event.lngLat.lat;
      if (activeTool === 'measure') {
        if (!measureFinished) setMeasurePoints((current) => [...current, [lng, lat]]);
      } else if (activeTool === 'annotate') {
        annotationSeqRef.current += 1;
        const sequence = annotationSeqRef.current;
        setAnnotations((current) => [...current, {
          id: 'annotation-' + Date.now() + '-' + sequence,
          lng,
          lat,
          label: t('annotate.default') + ' ' + sequence,
        }]);
      }
    };
    map.on('click', onClick);
    if (activeTool === 'measure') map.doubleClickZoom.disable();
    return () => {
      map.off('click', onClick);
      if (activeTool === 'measure') {
        try {
          map.doubleClickZoom.enable();
        } catch (error) {
          // The map may already be gone.
        }
      }
    };
  }, [activeTool, drawTarget, editTarget, measureFinished, ready, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const canvas = map.getCanvas();
    const previous = canvas.style.cursor;
    if (drawTarget) {
      canvas.style.cursor = 'crosshair';
    } else if (editTarget) {
      canvas.style.cursor = 'default';
    } else if (activeTool === 'measure' || activeTool === 'annotate') {
      canvas.style.cursor = activeTool === 'measure' && measureFinished ? 'default' : 'crosshair';
    }
    return () => {
      canvas.style.cursor = previous;
    };
  }, [activeTool, ready, measureFinished, drawTarget, editTarget]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || drawTarget || editTarget || activeTool !== 'measure') return undefined;
    const finish = (event) => {
      if (event && event.originalEvent && typeof event.originalEvent.preventDefault === 'function') {
        event.originalEvent.preventDefault();
      }
      setMeasureFinished(true);
    };
    const preventMenu = (event) => event.preventDefault();
    const canvas = map.getCanvas();
    map.on('contextmenu', finish);
    canvas.addEventListener('contextmenu', preventMenu);
    return () => {
      map.off('contextmenu', finish);
      canvas.removeEventListener('contextmenu', preventMenu);
    };
  }, [activeTool, drawTarget, editTarget, ready]);

  useEffect(() => {
    setDrawPoints([]);
  }, [drawTarget && drawTarget.layerId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    if (!map.getSource('gis-draw-source')) {
      map.addSource('gis-draw-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'gis-draw-fill',
        type: 'fill',
        source: 'gis-draw-source',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#e8843f', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'gis-draw-line',
        type: 'line',
        source: 'gis-draw-source',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#e8843f', 'line-width': 2, 'line-dasharray': [2, 1] },
      });
      map.addLayer({
        id: 'gis-draw-points',
        type: 'circle',
        source: 'gis-draw-source',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#e8843f',
          'circle-stroke-width': 2,
        },
      });
      map.addSource('gis-draw-preview-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'gis-draw-preview-fill',
        type: 'fill',
        source: 'gis-draw-preview-source',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#e8843f', 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'gis-draw-preview-line',
        type: 'line',
        source: 'gis-draw-preview-source',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#e8843f', 'line-width': 1.6, 'line-dasharray': [4, 3] },
      });
    }
    return () => {
      try {
        for (const layerId of ['gis-draw-preview-line', 'gis-draw-preview-fill', 'gis-draw-points', 'gis-draw-line', 'gis-draw-fill']) {
          if (map.getLayer(layerId)) map.removeLayer(layerId);
        }
        if (map.getSource('gis-draw-preview-source')) map.removeSource('gis-draw-preview-source');
        if (map.getSource('gis-draw-source')) map.removeSource('gis-draw-source');
      } catch (error) {
        // The map may already be removed.
      }
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map && map.getSource('gis-draw-source');
    if (!source || !ready) return;
    source.setData(drawFeatureCollection(drawPoints));
    for (const layerId of ['gis-draw-fill', 'gis-draw-line', 'gis-draw-points', 'gis-draw-preview-fill', 'gis-draw-preview-line']) {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    }
  }, [drawPoints, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map && map.getSource('gis-draw-preview-source');
    if (!source || !ready) return undefined;
    const clear = () => source.setData({ type: 'FeatureCollection', features: [] });
    if (!drawTarget || drawPoints.length === 0) {
      clear();
      return undefined;
    }
    const last = drawPoints[drawPoints.length - 1];
    const onMove = (event) => {
      if (!event || !event.lngLat) return;
      const next = [event.lngLat.lng, event.lngLat.lat];
      const features = [];
      if (drawPoints.length >= 2) {
        const ring = [...drawPoints, next, drawPoints[0]];
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } });
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
      } else {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [last, next] } });
      }
      source.setData({ type: 'FeatureCollection', features });
    };
    const onOut = () => clear();
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      clear();
    };
  }, [drawTarget, drawPoints, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const layerId of ['gis-draw-fill', 'gis-draw-line', 'gis-draw-points', 'gis-draw-preview-fill', 'gis-draw-preview-line']) {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    }
  }, [layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !drawTarget) return undefined;
    const onClick = (event) => {
      const lng = event.lngLat.lng;
      const lat = event.lngLat.lat;
      setDrawPoints((current) => [...current, [lng, lat]]);
    };
    const finish = (event) => {
      if (event && event.originalEvent && typeof event.originalEvent.preventDefault === 'function') {
        event.originalEvent.preventDefault();
      }
      finishDraw();
    };
    const preventMenu = (event) => event.preventDefault();
    const canvas = map.getCanvas();
    map.on('click', onClick);
    map.on('contextmenu', finish);
    canvas.addEventListener('contextmenu', preventMenu);
    map.doubleClickZoom.disable();
    return () => {
      map.off('click', onClick);
      map.off('contextmenu', finish);
      canvas.removeEventListener('contextmenu', preventMenu);
      try {
        map.doubleClickZoom.enable();
      } catch (error) {
        // The map may already be gone.
      }
    };
  }, [drawTarget, ready, finishDraw]);

  useEffect(() => {
    if (!drawTarget || typeof window === 'undefined') return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') cancelDraw();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawTarget, cancelDraw]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const onContextMenu = (event) => {
      if (drawTarget || editTarget || activeTool === 'measure') return;
      const point = event.point;
      if (!point) return;
      for (const layer of layers) {
        if (layer.source !== 'project' || layer.sourceFormat !== 'drawn') continue;
        const layerIds = [layer.id + '-fill', layer.id + '-line'].filter((id) => map.getLayer(id));
        if (layerIds.length === 0) continue;
        const hits = map.queryRenderedFeatures(point, { layers: layerIds });
        if (!hits.length) continue;
        if (event.originalEvent && typeof event.originalEvent.preventDefault === 'function') {
          event.originalEvent.preventDefault();
        }
        const properties = hits[0].properties || {};
        if (onFeatureMenu) {
          onFeatureMenu(
            event.originalEvent && event.originalEvent.clientX ? event.originalEvent.clientX : (typeof window !== 'undefined' ? window.innerWidth / 2 : 0),
            event.originalEvent && event.originalEvent.clientY ? event.originalEvent.clientY : (typeof window !== 'undefined' ? window.innerHeight / 2 : 0),
            layer,
            { name: properties.name, createdAt: properties.created_at },
          );
        }
        return;
      }
    };
    map.on('contextmenu', onContextMenu);
    return () => map.off('contextmenu', onContextMenu);
  }, [activeTool, drawTarget, editTarget, layers, ready, onFeatureMenu]);

  useEffect(() => {
    setEditFeature(null);
    editFeatureRef.current = null;
  }, [editTarget && editTarget.layerId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    if (!map.getSource('gis-edit-source')) {
      map.addSource('gis-edit-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'gis-edit-fill',
        type: 'fill',
        source: 'gis-edit-source',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#ffb84d', 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'gis-edit-line',
        type: 'line',
        source: 'gis-edit-source',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#ff9f1a', 'line-width': 2.2 },
      });
    }
    return () => {
      try {
        if (map.getLayer('gis-edit-line')) map.removeLayer('gis-edit-line');
        if (map.getLayer('gis-edit-fill')) map.removeLayer('gis-edit-fill');
        if (map.getSource('gis-edit-source')) map.removeSource('gis-edit-source');
      } catch (error) {
        // The map may already be gone.
      }
    };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map && map.getSource('gis-edit-source');
    if (!source || !ready) return;
    source.setData(editFeature ? editFeatureCollection(editFeature.ring) : { type: 'FeatureCollection', features: [] });
    for (const layerId of ['gis-edit-fill', 'gis-edit-line']) {
      if (map.getLayer(layerId)) map.moveLayer(layerId);
    }
  }, [editFeature, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !editTarget) return undefined;
    const targetLayer = layers.find((layer) => layer.layerId === editTarget.layerId);
    if (!targetLayer) return undefined;
    const onClick = (event) => {
      const layerIds = [targetLayer.id + '-fill', targetLayer.id + '-line'].filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(event.point, { layers: layerIds });
      if (!hits.length) {
        setEditFeature(null);
        return;
      }
      const ring = editRingFromGeometry(hits[0].geometry);
      if (!ring) return;
      const properties = hits[0].properties || {};
      setEditFeature({ name: properties.name, createdAt: properties.created_at, ring });
    };
    map.on('click', onClick);
    return () => map.off('click', onClick);
  }, [editTarget, layers, ready]);

  useEffect(() => {
    const map = mapRef.current;
    for (const marker of editMarkersRef.current) marker.remove();
    editMarkersRef.current = [];
    if (!map || !ready || !editFeature || !Array.isArray(editFeature.ring)) return undefined;
    const ring = editFeature.ring;
    for (let index = 0; index < ring.length - 1; index += 1) {
      const element = document.createElement('div');
      element.className = 'gis-vertex-marker';
      const marker = new maplibregl.Marker({ element, draggable: true, anchor: 'center' })
        .setLngLat(ring[index])
        .addTo(map);
      marker.on('drag', () => {
        const current = editFeatureRef.current;
        if (!current) return;
        const lngLat = marker.getLngLat();
        const next = current.ring.map((point) => point.slice());
        next[index] = [lngLat.lng, lngLat.lat];
        const updated = Object.assign({}, current, { ring: next });
        editFeatureRef.current = updated;
        setEditFeature(updated);
      });
      marker.on('dragend', () => { saveEditGeometry(); });
      editMarkersRef.current.push(marker);
    }
    return () => {
      for (const marker of editMarkersRef.current) marker.remove();
      editMarkersRef.current = [];
    };
  }, [editFeature && editFeature.name, editFeature && editFeature.createdAt, editTarget && editTarget.layerId, ready, saveEditGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !editTarget) return undefined;
    const targetLayer = layers.find((layer) => layer.layerId === editTarget.layerId);
    if (!targetLayer) return undefined;
    map.dragPan.disable();
    const onDown = (event) => {
      const feature = editFeatureRef.current;
      if (!feature) return;
      const layerIds = [targetLayer.id + '-fill'].filter((id) => map.getLayer(id));
      const hits = map.queryRenderedFeatures(event.point, { layers: layerIds });
      if (!hits.length) return;
      const properties = hits[0].properties || {};
      if (properties.name !== feature.name || properties.created_at !== feature.createdAt) return;
      editDragRef.current = {
        start: [event.lngLat.lng, event.lngLat.lat],
        ring: feature.ring.map((point) => point.slice()),
        moved: false,
      };
    };
    const onMove = (event) => {
      const drag = editDragRef.current;
      const feature = editFeatureRef.current;
      if (!drag || !feature) return;
      const dx = event.lngLat.lng - drag.start[0];
      const dy = event.lngLat.lat - drag.start[1];
      if (Math.abs(dx) > 1e-10 || Math.abs(dy) > 1e-10) drag.moved = true;
      const next = drag.ring.map((point) => [point[0] + dx, point[1] + dy]);
      const updated = Object.assign({}, feature, { ring: next });
      editFeatureRef.current = updated;
      setEditFeature(updated);
      editMarkersRef.current.forEach((marker, index) => {
        if (next[index]) marker.setLngLat(next[index]);
      });
    };
    const onUp = () => {
      if (!editDragRef.current) return;
      const moved = editDragRef.current.moved;
      editDragRef.current = null;
      if (moved) saveEditGeometry();
    };
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    return () => {
      map.off('mousedown', onDown);
      map.off('mousemove', onMove);
      map.off('mouseup', onUp);
      editDragRef.current = null;
      try {
        map.dragPan.enable();
      } catch (error) {
        // Map may be gone.
      }
    };
  }, [editTarget, layers, ready, saveEditGeometry]);

  useEffect(() => {
    if (!editTarget || typeof window === 'undefined') return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onCancelEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editTarget, onCancelEdit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const seen = new Set();
    annotations.forEach((annotation, index) => {
      seen.add(annotation.id);
      let marker = markersRef.current.get(annotation.id);
      if (!marker) {
        const element = document.createElement('div');
        element.className = 'gis-marker';
        element.addEventListener('click', (event) => event.stopPropagation());
        marker = new maplibregl.Marker({ element, anchor: 'bottom' })
          .setLngLat([annotation.lng, annotation.lat])
          .addTo(map);
        markersRef.current.set(annotation.id, marker);
      } else {
        marker.setLngLat([annotation.lng, annotation.lat]);
      }
      const element = marker.getElement();
      element.textContent = String(index + 1);
      element.title = annotation.label;
      element.setAttribute('aria-label', annotation.label);
    });
    for (const [id, marker] of markersRef.current) {
      if (seen.has(id)) continue;
      marker.remove();
      markersRef.current.delete(id);
    }
    return undefined;
  }, [annotations, ready]);

  useEffect(() => () => {
    for (const marker of markersRef.current.values()) {
      try {
        marker.remove();
      } catch (error) {
        // The map may already be gone.
      }
    }
    markersRef.current.clear();
  }, []);

  return h('div', { className: 'gis-map-shell' + (activeTool === 'measure' && !measureFinished ? ' is-measuring' : '') },
    h('div', { ref: containerRef, className: 'gis-map', role: 'application', 'aria-label': t('map.aria'), 'data-maplibre-version': (maplibregl && maplibregl.version) || 'maplibre' }),
    !ready && !mapError ? h('div', { className: 'gis-map-loading' }, h('span', { className: 'gis-loading-dot' }), t('map.loading')) : null,
    mapError ? h('div', { className: 'gis-map-error' }, h(SvgIcon, { name: 'warning', size: 13 }), mapError) : null,
    ready && !mapError && layers.length === 0 ? h('div', { className: 'gis-empty' },
      h('div', { className: 'gis-empty-icon' }, h(SvgIcon, { name: 'layers', size: 23 })),
      h('div', { className: 'gis-empty-title' }, t('map.emptyTitle')),
      h('div', { className: 'gis-empty-body' }, t('map.emptyBody')),
      h('div', { className: 'gis-empty-prompt' }, h(SvgIcon, { name: 'chat', size: 12 }), t('map.emptyPrompt')),
    ) : null,
    h('div', { className: 'gis-map-title-card' },
      h('span', { className: 'gis-map-title-text' }, t('map.title')),
      h('span', { className: 'gis-map-title-sub' }, layers.length === 0 ? t('map.subtitleEmpty') : t('map.subtitleActive', { count: layers.length })),
    ),
    h('div', { className: 'gis-map-actions' },
      h('div', { className: 'gis-compass', title: 'N', 'aria-hidden': 'true' },
        h('svg', { width: 22, height: 22, viewBox: '0 0 22 22' },
          h('circle', { cx: 11, cy: 11, r: 9, fill: 'none', stroke: 'var(--dsw-alias-border-l2)', strokeWidth: 1 }),
          h('path', { d: 'M11 3.5 13.2 11H8.8L11 3.5Z', fill: 'var(--dsw-alias-brand-primary)' }),
          h('path', { d: 'M11 18.5 8.8 11h4.4L11 18.5Z', fill: 'var(--dsw-alias-label-secondary)' }),
          h('text', { x: 11, y: 2.6, textAnchor: 'middle', style: { fontSize: '4.5px', fontWeight: 700, fill: 'var(--dsw-alias-label-secondary)' } }, 'N'),
        ),
      ),
      h('button', { type: 'button', className: 'gis-icon-btn', title: t('map.zoomIn'), 'aria-label': t('map.zoomIn'), onClick: () => zoomBy(1.25) }, h(SvgIcon, { name: 'plus', size: 16 })),
      h('button', { type: 'button', className: 'gis-icon-btn', title: t('map.zoomOut'), 'aria-label': t('map.zoomOut'), onClick: () => zoomBy(0.8) }, h(SvgIcon, { name: 'minus', size: 16 })),
      h('button', { type: 'button', className: 'gis-icon-btn', title: t('map.reset'), 'aria-label': t('map.reset'), onClick: resetView }, h(SvgIcon, { name: 'reset', size: 15 })),
    ),
    h('div', { className: 'gis-readout' },
      h('span', { className: 'gis-readout-item' },
        h('span', { className: 'gis-readout-key' }, t('map.lon')),
        h('span', { className: 'gis-readout-val' }, position ? position.lng.toFixed(4) + '°' : '—'),
      ),
      h('span', { className: 'gis-readout-item' },
        h('span', { className: 'gis-readout-key' }, t('map.lat')),
        h('span', { className: 'gis-readout-val' }, position ? position.lat.toFixed(4) + '°' : '—'),
      ),
      h('span', { className: 'gis-readout-item' },
        h('span', { className: 'gis-readout-key' }, t('map.zoom')),
        h('span', { className: 'gis-readout-val' }, zoom.toFixed(1)),
      ),
    ),
    h('div', { className: 'gis-hint' }, t('map.hint')),
    drawTarget
      ? h(DrawPanel, {
        t,
        target: drawTarget,
        points: drawPoints,
        saving: drawSaving,
        onUndo: () => setDrawPoints((current) => current.slice(0, -1)),
        onFinish: finishDraw,
        onCancel: cancelDraw,
      })
      : editTarget
      ? h(EditPanel, {
        t,
        target: editTarget,
        feature: editFeature,
        onClear: () => setEditFeature(null),
        onExit: onCancelEdit,
        onAppend: () => onAppendLayer && onAppendLayer(editTarget),
      })
      : activeTool === 'measure'
      ? h(MeasurePanel, {
        t,
        mode: measureMode,
        points: measurePoints,
        hover: measureHover,
        finished: measureFinished,
        onMode: (nextMode) => {
          setMeasureMode(nextMode);
          setMeasurePoints([]);
          setMeasureFinished(false);
        },
        onUndo: () => {
          setMeasurePoints((current) => current.slice(0, -1));
          setMeasureFinished(false);
        },
        onClear: () => {
          setMeasurePoints([]);
          setMeasureFinished(false);
        },
        onFinish: () => setMeasureFinished(true),
        onResume: () => setMeasureFinished(false),
      })
      : activeTool === 'annotate'
        ? h(AnnotationPanel, {
          t,
          annotations,
          onRename: (id, label) => setAnnotations((current) => current.map((annotation) => annotation.id === id ? Object.assign({}, annotation, { label }) : annotation)),
          onDelete: (id) => setAnnotations((current) => current.filter((annotation) => annotation.id !== id)),
          onClear: () => setAnnotations([]),
          onFocus: (annotation) => {
            const map = mapRef.current;
            if (map) map.flyTo({ center: [annotation.lng, annotation.lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
          },
        })
        : activeTool === 'layers'
          ? h(LayerPanel, { t, onToggleLayer, onRemoveLayer, onSaveLayer, onReorderLayers, onLocateLayer: locateLayer, onNotify, onLayerMenu, onNewVectorLayer, onEditLayer, onAppendLayer, onRefreshLayers, projectName })
          : null,
  );
}

function LayerPanel({ t, onToggleLayer, onRemoveLayer, onSaveLayer, onReorderLayers, onLocateLayer, onNotify, onLayerMenu, onNewVectorLayer, onEditLayer, onAppendLayer, onRefreshLayers, projectName }) {
  const layers = useLayerStore();
  const [dragKey, setDragKey] = useState(null);
  const [dropHint, setDropHint] = useState(null);
  const credits = [...new Set(layers.map((layer) => layer.attribution).filter(Boolean))].join(' · ');
  return h('div', { className: 'gis-panel' },
    h('div', { className: 'gis-panel-head' },
      h('span', { className: 'gis-panel-title' }, t('layers.title')),
      h('div', { className: 'gis-panel-head-actions' },
        h('span', { className: 'gis-panel-count' }, layers.length),
        onRefreshLayers ? h('button', {
          type: 'button',
          className: 'gis-icon-btn gis-icon-btn-sm',
          title: t('layers.refresh'),
          'aria-label': t('layers.refresh'),
          onClick: onRefreshLayers,
        }, h(SvgIcon, { name: 'refresh', size: 12 })) : null,
        onNewVectorLayer ? h('button', {
          type: 'button',
          className: 'gis-icon-btn gis-icon-btn-sm',
          title: t('layers.newVector'),
          'aria-label': t('layers.newVector'),
          onClick: onNewVectorLayer,
        }, h(SvgIcon, { name: 'plus', size: 12 })) : null,
      ),
    ),
    layers.length === 0
      ? h('div', { className: 'gis-layer-empty' },
        h('span', { className: 'gis-layer-empty-title' }, t('layers.emptyTitle')),
        h('span', { className: 'gis-layer-empty-body' }, t('layers.emptyBody')),
        h('span', { className: 'gis-layer-example' }, t('layers.example')),
      )
      : h('div', { className: 'gis-layer-list' },
        layers.map((layer) => h('div', {
          key: layer.key,
          className: 'gis-layer-item' + (layer.renderKind === 'unsupported' ? ' is-unsupported' : '')
            + (dragKey === layer.key ? ' is-dragging' : '')
            + (dropHint && dropHint.key === layer.key ? ' is-drop-' + (dropHint.after ? 'after' : 'before') : ''),
          draggable: true,
          title: layer.name,
          'aria-grabbed': dragKey === layer.key,
          onContextMenu: (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (onLayerMenu) onLayerMenu(event, layer);
          },
          onDragStart: (event) => {
            setDragKey(layer.key);
            try {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', layer.key);
            } catch (error) {
              // Some browsers expose a restricted dataTransfer.
            }
          },
          onDragEnd: () => {
            setDragKey(null);
            setDropHint(null);
          },
          onDragOver: (event) => {
            if (!dragKey || dragKey === layer.key) return;
            event.preventDefault();
            try {
              event.dataTransfer.dropEffect = 'move';
            } catch (error) {
              // Ignore restricted dataTransfer.
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const after = event.clientY > rect.top + rect.height / 2;
            setDropHint({ key: layer.key, after });
          },
          onDragLeave: (event) => {
            if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget)) setDropHint(null);
          },
          onDrop: (event) => {
            event.preventDefault();
            const sourceKey = dragKey || (event.dataTransfer && event.dataTransfer.getData('text/plain'));
            const rect = event.currentTarget.getBoundingClientRect();
            const after = dropHint && dropHint.key === layer.key
              ? dropHint.after
              : event.clientY > rect.top + rect.height / 2;
            setDragKey(null);
            setDropHint(null);
            if (sourceKey && sourceKey !== layer.key && onReorderLayers) {
              onReorderLayers(sourceKey, layer.key, after);
            }
          },
        },
          h('span', { className: 'gis-layer-thumb' }, h(SvgIcon, { name: layer.renderKind === 'unsupported' ? 'file' : 'image', size: 15 })),
          h('div', { className: 'gis-layer-copy' },
            h('span', { className: 'gis-layer-name', title: layer.name }, layer.name),
            h('span', { className: 'gis-layer-meta' }, layer.source === 'project'
              ? datasetKindLabel(layer.datasetKind, t) + (formatLabel(layer.format, layer.sourceFormat, t) ? ' · ' + formatLabel(layer.format, layer.sourceFormat, t) : '') + (layer.renderKind === 'unsupported' ? ' · ' + t('layers.unsupported') : '')
              : t('layers.session') + ' · ' + t('layers.raster')),
            layer.style && layer.style.categorical && layer.style.categorical.values
              ? h('div', { className: 'gis-layer-legend' },
                Object.entries(layer.style.categorical.values).map(([value, item]) => h('span', { key: value, className: 'gis-legend-item' },
                  h('span', { className: 'gis-legend-swatch', style: { background: item.color } }),
                  h('span', { className: 'gis-legend-label' }, item.label || value),
                )),
              )
              : null,
          ),
          h('div', { className: 'gis-layer-actions' },
            Array.isArray(layer.bbox) && layer.bbox.length === 4 ? h('button', {
              type: 'button',
              className: 'gis-layer-action',
              title: t('layers.zoomTo'),
              'aria-label': t('layers.zoomTo'),
              onClick: () => { if (onLocateLayer) onLocateLayer(layer); },
            }, h(SvgIcon, { name: 'locate', size: 13 })) : null,
            layer.source === 'project' && layer.sourceFormat === 'drawn' && onEditLayer ? h('button', {
              type: 'button',
              className: 'gis-layer-action',
              title: t('layers.editVector'),
              'aria-label': t('layers.editVector'),
              onClick: () => onEditLayer(layer),
            }, h(SvgIcon, { name: 'pencil', size: 13 })) : null,
            layer.source === 'project' && layer.sourceFormat === 'drawn' && onAppendLayer ? h('button', {
              type: 'button',
              className: 'gis-layer-action',
              title: t('layers.appendVector'),
              'aria-label': t('layers.appendVector'),
              onClick: () => onAppendLayer({ datasetId: layer.datasetId, layerId: layer.layerId, name: layer.name }),
            }, h(SvgIcon, { name: 'plus', size: 13 })) : null,
            layer.source !== 'project' && onSaveLayer ? h('button', {
              type: 'button',
              className: 'gis-layer-action',
              title: t('layers.saveToProject'),
              'aria-label': t('layers.saveToProject'),
              onClick: () => onSaveLayer(layer),
            }, h(SvgIcon, { name: 'database', size: 13 })) : null,
            h('button', {
              type: 'button',
              className: 'gis-layer-action' + (layer.visible ? '' : ' is-off'),
              title: layer.visible ? t('layers.hide') : t('layers.show'),
              'aria-label': layer.visible ? t('layers.hide') : t('layers.show'),
              'aria-pressed': layer.visible,
              onClick: () => { if (onToggleLayer) onToggleLayer(layer); else toggleLayerVisibility(layer.key); },
            }, h(SvgIcon, { name: layer.visible ? 'eye' : 'eye-off', size: 13 })),
            h('button', {
              type: 'button',
              className: 'gis-layer-action',
              title: t('layers.remove'),
              'aria-label': t('layers.remove'),
              onClick: () => { if (onRemoveLayer) onRemoveLayer(layer); else removeLayer(layer.key); },
            }, h(SvgIcon, { name: 'trash', size: 13 })),
          ),
        )),
      ),
    h('div', { className: 'gis-panel-foot' }, (projectName ? projectName + ' · ' : '') + t('map.attribution') + (credits ? ' · ' + credits : '')),
  );
}

const EARTH_RADIUS = 6371008.8;

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function measureDistance(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [lng1, lat1] = points[index - 1];
    const [lng2, lat2] = points[index];
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
    total += 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

function measureArea(points) {
  if (points.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [lng1, lat1] = points[index];
    const [lng2, lat2] = points[(index + 1) % points.length];
    total += toRadians(lng2 - lng1) * (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

function formatDistance(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  return meters < 1000 ? meters.toFixed(1) + ' m' : (meters / 1000).toFixed(2) + ' km';
}

function formatArea(squareMeters) {
  if (!Number.isFinite(squareMeters) || squareMeters <= 0) return '—';
  return squareMeters < 1000000
    ? squareMeters.toFixed(1) + ' m²'
    : (squareMeters / 1000000).toFixed(2) + ' km²';
}

function measurementFeatureCollection(points, mode) {
  const features = [];
  const closed = mode === 'area' && points.length >= 3 ? [...points, points[0]] : points;
  if (closed.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: closed },
    });
  }
  if (mode === 'area' && closed.length >= 4) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closed] },
    });
  }
  for (const point of points) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: point },
    });
  }
  return { type: 'FeatureCollection', features };
}

function drawFeatureCollection(points) {
  const features = [];
  const closed = points.length >= 3 ? [...points, points[0]] : points;
  if (closed.length >= 2) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: closed } });
  }
  if (points.length >= 3) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closed] } });
  }
  for (const point of points) {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } });
  }
  return { type: 'FeatureCollection', features };
}

function MeasurePanel({ t, mode, points, hover, finished, onMode, onUndo, onClear, onFinish, onResume }) {
  const previewPoints = hover && !finished ? [...points, hover] : points;
  const value = mode === 'area'
    ? (previewPoints.length >= 3 ? formatArea(measureArea(previewPoints)) : '—')
    : (previewPoints.length >= 2 ? formatDistance(measureDistance(previewPoints)) : '—');
  const canFinish = mode === 'area' ? points.length >= 3 : points.length >= 2;
  const hint = finished
    ? t('measure.finished')
    : points.length === 0
      ? t('measure.empty')
      : t('measure.hint');
  return h('div', { className: 'gis-panel gis-tool-panel' },
    h('div', { className: 'gis-panel-head' },
      h('span', { className: 'gis-panel-title' }, t('tools.measure')),
      h('div', { className: 'gis-panel-head-actions' },
        h('span', { className: 'gis-panel-count' }, t('measure.points', { count: points.length })),
        finished ? h('button', {
          type: 'button',
          className: 'gis-icon-btn gis-icon-btn-sm gis-measure-close',
          title: t('measure.clear'),
          'aria-label': t('measure.clear'),
          onClick: onClear,
        }, h(SvgIcon, { name: 'close', size: 12 })) : null,
      ),
    ),
    h('div', { className: 'gis-measure-tabs' },
      h('button', { type: 'button', className: 'gis-tab' + (mode === 'distance' ? ' is-active' : ''), onClick: () => onMode('distance') }, t('measure.distance')),
      h('button', { type: 'button', className: 'gis-tab' + (mode === 'area' ? ' is-active' : ''), onClick: () => onMode('area') }, t('measure.area')),
    ),
    h('div', { className: 'gis-measure-value' }, value),
    h('div', { className: 'gis-tool-hint' + (finished ? ' is-finished' : '') }, hint),
    h('div', { className: 'gis-tool-actions' },
      finished
        ? h('button', { type: 'button', className: 'gis-tool-btn', onClick: onResume }, t('measure.resume'))
        : [
          h('button', { key: 'undo', type: 'button', className: 'gis-tool-btn', disabled: points.length === 0, onClick: onUndo }, t('measure.undo')),
          h('button', { key: 'finish', type: 'button', className: 'gis-tool-btn gis-btn-primary', disabled: !canFinish, onClick: onFinish }, t('measure.finish')),
        ],
      h('button', { type: 'button', className: 'gis-tool-btn', disabled: points.length === 0, onClick: onClear }, t('measure.clear')),
    ),
  );
}

function EditPanel({ t, target, feature, onClear, onExit, onAppend }) {
  return h('div', { className: 'gis-panel gis-tool-panel' },
    h('div', { className: 'gis-panel-head' },
      h('span', { className: 'gis-panel-title' }, t('layers.editMode')),
      h('span', { className: 'gis-panel-count' }, feature ? (feature.name || t('layers.polygon')) : ''),
    ),
    h('div', { className: 'gis-draw-target', title: target ? target.name : '' }, target ? target.name : ''),
    h('div', { className: 'gis-tool-hint' }, feature ? t('layers.editHint') : t('layers.editSelect')),
    h('div', { className: 'gis-tool-actions' },
      feature ? h('button', { type: 'button', className: 'gis-tool-btn', onClick: onClear }, t('layers.editClear')) : null,
      h('button', { type: 'button', className: 'gis-tool-btn', onClick: onAppend }, t('layers.appendVector')),
      h('button', { type: 'button', className: 'gis-tool-btn', onClick: onExit }, t('layers.editExit')),
    ),
  );
}

function DrawPanel({ t, target, points, saving, onUndo, onFinish, onCancel }) {
  return h('div', { className: 'gis-panel gis-tool-panel' },
    h('div', { className: 'gis-panel-head' },
      h('span', { className: 'gis-panel-title' }, t('layers.drawing')),
      h('span', { className: 'gis-panel-count' }, t('layers.drawPoints', { count: points.length })),
    ),
    h('div', { className: 'gis-draw-target', title: target ? target.name : '' }, target ? target.name : ''),
    h('div', { className: 'gis-tool-hint' }, t('layers.drawHint')),
    h('div', { className: 'gis-tool-actions' },
      h('button', { type: 'button', className: 'gis-tool-btn', disabled: points.length === 0, onClick: onUndo }, t('layers.drawUndo')),
      h('button', { type: 'button', className: 'gis-tool-btn gis-btn-primary', disabled: saving || points.length < 3, onClick: onFinish }, t('layers.drawComplete')),
      h('button', { type: 'button', className: 'gis-tool-btn', onClick: onCancel }, t('layers.drawCancel')),
    ),
  );
}

function AnnotationPanel({ t, annotations, onRename, onDelete, onClear, onFocus }) {
  return h('div', { className: 'gis-panel gis-tool-panel' },
    h('div', { className: 'gis-panel-head' },
      h('span', { className: 'gis-panel-title' }, t('tools.annotate')),
      h('span', { className: 'gis-panel-count' }, annotations.length),
    ),
    annotations.length === 0
      ? h('div', { className: 'gis-layer-empty' }, t('annotate.empty'))
      : h('div', { className: 'gis-annotation-list' },
        annotations.map((annotation, index) => h('div', { key: annotation.id, className: 'gis-annotation-row' },
          h('span', { className: 'gis-annotation-index' }, String(index + 1)),
          h('input', {
            className: 'gis-input gis-annotation-input',
            value: annotation.label,
            title: t('annotate.name'),
            'aria-label': t('annotate.name'),
            onChange: (event) => onRename(annotation.id, event.target.value),
          }),
          h('button', { type: 'button', className: 'gis-layer-action', title: t('annotate.locate'), 'aria-label': t('annotate.locate'), onClick: () => onFocus(annotation) }, h(SvgIcon, { name: 'locate', size: 12 })),
          h('button', { type: 'button', className: 'gis-layer-action', title: t('annotate.delete'), 'aria-label': t('annotate.delete'), onClick: () => onDelete(annotation.id) }, h(SvgIcon, { name: 'trash', size: 12 })),
        )),
      ),
    h('div', { className: 'gis-tool-hint' }, t('annotate.hint')),
    h('div', { className: 'gis-tool-actions' },
      h('button', { type: 'button', className: 'gis-tool-btn', disabled: annotations.length === 0, onClick: onClear }, t('annotate.clear')),
    ),
  );
}

function formatBytes(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '—';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  return (size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatLabel(format, sourceFormat, t) {
  if (sourceFormat === 'postgis') return t('dataset.pgDatabase');
  return format || '';
}

function datasetKindLabel(kind, t) {
  return t('dataset.kind.' + (kind || 'table'));
}

function datasetMeta(dataset, t) {
  const profile = dataset && dataset.profile ? dataset.profile : {};
  const parts = [datasetKindLabel(dataset && dataset.kind, t)];
  if (profile.format || profile.sourceFormat) parts.push(formatLabel(profile.format, profile.sourceFormat, t));
  if (Number.isFinite(profile.featureCount)) parts.push(t('dataset.features', { count: profile.featureCount }));
  if (Number.isFinite(profile.rowCountSample)) parts.push(t('dataset.rows', { count: profile.rowCountSample }));
  if (Number.isFinite(profile.sizeBytes)) parts.push(formatBytes(profile.sizeBytes));
  if (dataset && dataset.crs) parts.push(t('dataset.crs', { crs: dataset.crs }));
  if (profile.conversionError) parts.push(t('dataset.conversionFailed'));
  return parts.join(' · ');
}

function absoluteResourceUrl(value) {
  const text = String(value || '');
  if (!text || /^https?:/i.test(text) || text.startsWith('//')) return text;
  if (text.startsWith('/') && typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin + text;
  }
  return text;
}

function projectLayerToStore(layer, projectId) {
  const dataset = layer.dataset || {};
  const profile = dataset.profile || {};
  const format = dataset.format || profile.format;
  const bbox = Array.isArray(dataset.bbox) ? dataset.bbox : null;
  let renderKind = 'unsupported';
  let tileUrl;
  let url;
  if (dataset.kind === 'raster' && format === 'xyz') {
    renderKind = 'raster-tiles';
    tileUrl = dataset.uri;
  } else if (dataset.kind === 'raster' && format === 'cog' && dataset.tilesUrl && profile.renderable !== false) {
    renderKind = 'raster-tiles';
    tileUrl = dataset.tilesUrl;
  } else if (dataset.kind === 'vector' && (format === 'geojson' || format === 'gpkg') && profile.renderable !== false) {
    renderKind = 'geojson';
    const contentUrl = dataset.contentUrl || api.contentUrl(dataset.id);
    const version = [profile.updatedAt || '', profile.featureCount ?? 0, bbox ? bbox.join(',') : '', profile.previewSizeBytes ?? 0].join('|');
    url = absoluteResourceUrl(contentUrl) + (contentUrl.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(version);
  } else if (dataset.kind === 'raster' && format === 'image' && bbox) {
    renderKind = 'image';
    url = absoluteResourceUrl(dataset.contentUrl || api.contentUrl(dataset.id));
  }
  return {
    key: 'project:' + layer.id,
    name: layer.name || profile.name || dataset.uri || '图层',
    visible: layer.visible !== false,
    z: Number.isFinite(Number(layer.z)) ? Number(layer.z) : 0,
    source: 'project',
    persisted: true,
    layerId: layer.id,
    datasetId: layer.datasetId,
    projectId,
    renderKind,
    tileUrl,
    url,
    bbox,
    style: layer.style && typeof layer.style === 'object' ? layer.style : {},
    datasetKind: dataset.kind,
    format,
    sourceFormat: profile.sourceFormat,
    layerName: profile.layerName || '',
    fields: Array.isArray(profile.fields) ? profile.fields : [],
    attribution: profile.attribution || '天地图',
    tileSize: profile.tileSize || 256,
    minzoom: profile.minzoom ?? 0,
    maxzoom: profile.maxzoom ?? 18,
  };
}

function datasetDisplayName(dataset) {
  const profile = dataset && dataset.profile ? dataset.profile : {};
  if (profile.name) return profile.name;
  if (profile.fileName) return profile.fileName;
  const uri = String(dataset && dataset.uri ? dataset.uri : '');
  const clean = uri.split(/[?#]/)[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || uri || '数据集';
}

function NewProjectDialog({ t, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(value);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return h('div', { className: 'gis-modal', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
    h('form', { className: 'gis-modal-card gis-modal-small', onSubmit: submit },
      h('div', { className: 'gis-modal-head' },
        h('div', { className: 'gis-modal-title' }, t('project.new')),
        h('button', { type: 'button', className: 'gis-icon-btn gis-icon-btn-sm', onClick: onClose, 'aria-label': t('project.cancel') }, h(SvgIcon, { name: 'close', size: 14 })),
      ),
      h('div', { className: 'gis-modal-body' },
        h('label', { className: 'gis-field-label' }, t('project.title')),
        h('input', {
          className: 'gis-input',
          value: name,
          autoFocus: true,
          placeholder: t('project.namePlaceholder'),
          onChange: (event) => setName(event.target.value),
        }),
        error ? h('div', { className: 'gis-form-error' }, error) : null,
      ),
      h('div', { className: 'gis-modal-actions' },
        h('button', { type: 'button', className: 'gis-btn', onClick: onClose }, t('project.cancel')),
        h('button', { type: 'submit', className: 'gis-btn gis-btn-primary', disabled: busy || !name.trim() }, busy ? t('project.loading') : t('project.create')),
      ),
    ),
  );
}

function NewVectorLayerDialog({ t, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    const value = name.trim();
    if (!value || busy) return;
    setBusy(true);
    setError('');
    try {
      await onCreate(value);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return h('div', { className: 'gis-modal', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
    h('form', { className: 'gis-modal-card gis-modal-small', onSubmit: submit },
      h('div', { className: 'gis-modal-head' },
        h('div', { className: 'gis-modal-title' }, t('layers.newVectorTitle')),
        h('button', { type: 'button', className: 'gis-icon-btn gis-icon-btn-sm', onClick: onClose, 'aria-label': t('project.cancel') }, h(SvgIcon, { name: 'close', size: 14 })),
      ),
      h('div', { className: 'gis-modal-body' },
        h('label', { className: 'gis-field-label' }, t('layers.vectorName')),
        h('input', {
          className: 'gis-input',
          value: name,
          autoFocus: true,
          placeholder: t('layers.newVectorTitle'),
          onChange: (event) => setName(event.target.value),
        }),
        h('div', { className: 'gis-tool-hint' }, t('layers.vectorHint')),
        error ? h('div', { className: 'gis-form-error' }, error) : null,
      ),
      h('div', { className: 'gis-modal-actions' },
        h('button', { type: 'button', className: 'gis-btn', onClick: onClose }, t('project.cancel')),
        h('button', { type: 'submit', className: 'gis-btn gis-btn-primary', disabled: busy || !name.trim() }, busy ? t('project.loading') : t('layers.createVector')),
      ),
    ),
  );
}

function uploadFingerprint(file) {
  return [file.name, file.size, file.lastModified || 0].join(':');
}

function uploadStorageKey(fingerprint) {
  return 'gis-workbench.upload.' + fingerprint;
}

function readUploadId(fingerprint) {
  try {
    return window.localStorage.getItem(uploadStorageKey(fingerprint)) || '';
  } catch (error) {
    return '';
  }
}

function writeUploadId(fingerprint, uploadId) {
  try {
    if (uploadId) window.localStorage.setItem(uploadStorageKey(fingerprint), uploadId);
    else window.localStorage.removeItem(uploadStorageKey(fingerprint));
  } catch (error) {
    // Resuming after a reload is best effort.
  }
}

const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

function DatasetManager({ projectId, t, onClose, onChanged, notify }) {
  const [tab, setTab] = useState('list');
  const [datasets, setDatasets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [browse, setBrowse] = useState(null);
  const [browsePath, setBrowsePath] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMeta, setUploadMeta] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('idle');
  const [uploadStatusMessage, setUploadStatusMessage] = useState('');
  const uploadAbortRef = useRef(null);
  const uploadPausedRef = useRef(false);
  const [tileUrl, setTileUrl] = useState(DEFAULT_TILE_URL);
  const [tileName, setTileName] = useState(DEFAULT_LAYER_NAME);
  const [databases, setDatabases] = useState([]);
  const [activeDatabaseId, setActiveDatabaseId] = useState('');
  const [databaseTables, setDatabaseTables] = useState([]);
  const [databaseBusy, setDatabaseBusy] = useState(false);
  const [databaseMessage, setDatabaseMessage] = useState('');
  const [databaseForm, setDatabaseForm] = useState({
    name: '',
    host: '127.0.0.1',
    port: 5432,
    dbname: '',
    username: '',
    password: '',
    sslmode: 'prefer',
  });

  const fail = useCallback((reason) => {
    const text = reason instanceof Error ? reason.message : String(reason || t('dataset.failed'));
    setMessage(text);
    if (notify) notify(text);
  }, [notify, t]);

  const loadDatasets = useCallback(async () => {
    if (!projectId) return;
    try {
      const rows = await api.listDatasets(projectId);
      setDatasets(rows);
    } catch (reason) {
      fail(reason);
    }
  }, [projectId, fail]);

  const loadBrowse = useCallback(async (pathname) => {
    setBusy(true);
    try {
      const result = await api.browse(pathname);
      setBrowse(result);
      setBrowsePath(result.path);
      setSelectedFile(null);
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  }, [fail]);

  const loadDatabases = useCallback(async () => {
    if (!projectId) return;
    try {
      const rows = await api.listDatabases(projectId);
      setDatabases(rows);
      setActiveDatabaseId((current) => current && rows.some((row) => row.id === current) ? current : (rows[0] ? rows[0].id : ''));
    } catch (reason) {
      setDatabaseMessage(reason instanceof Error ? reason.message : t('dataset.dbFailed'));
    }
  }, [projectId, t]);

  const loadDatabaseTables = useCallback(async (databaseId) => {
    if (!databaseId) return;
    setDatabaseBusy(true);
    setDatabaseMessage('');
    try {
      const tables = await api.listDatabaseTables(databaseId);
      setDatabaseTables(tables);
      if (tables.length === 0) setDatabaseMessage(t('dataset.dbNoTables'));
    } catch (reason) {
      setDatabaseTables([]);
      setDatabaseMessage(reason instanceof Error ? reason.message : t('dataset.dbFailed'));
    } finally {
      setDatabaseBusy(false);
    }
  }, [t]);

  useEffect(() => {
    loadDatasets();
  }, [loadDatasets]);

  useEffect(() => {
    if (tab === 'database') loadDatabases();
    // Load once when the Database tab is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab === 'database' && activeDatabaseId) loadDatabaseTables(activeDatabaseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDatabaseId]);

  useEffect(() => {
    if (tab === 'browse' && !browse) loadBrowse(browsePath || undefined);
    // Load once when the Browse tab is opened; navigation is driven by the path bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const addDatasetLayer = async (dataset) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.createLayer(projectId, { datasetId: dataset.id, name: datasetDisplayName(dataset) });
      setMessage(t('dataset.layerAdded'));
      if (onChanged) onChanged();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const convertToCog = async (dataset) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const converted = await api.convertDataset(dataset.id);
      if (converted && converted.profile && converted.profile.renderable) {
        const existing = await api.listLayers(projectId);
        if (!existing.some((layer) => layer.datasetId === converted.id)) {
          await api.createLayer(projectId, { datasetId: converted.id, name: datasetDisplayName(converted) });
          setMessage(t('dataset.layerAdded'));
        } else {
          setMessage(t('dataset.registered'));
        }
        if (onChanged) onChanged();
      } else {
        setMessage(t('dataset.conversionFailed'));
      }
      await loadDatasets();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const removeDataset = async (dataset) => {
    if (busy) return;
    if (typeof window !== 'undefined' && !window.confirm(t('dataset.deleteConfirm'))) return;
    setBusy(true);
    try {
      await api.deleteDataset(dataset.id);
      setMessage(t('dataset.deleted'));
      await loadDatasets();
      if (onChanged) onChanged();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const registerSelected = async () => {
    if (!selectedFile || busy) return;
    setBusy(true);
    try {
      await api.createDataset(projectId, { path: selectedFile.path, addLayer: true });
      setMessage(t('dataset.registered'));
      setSelectedFile(null);
      await loadDatasets();
      if (onChanged) onChanged();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => {
    uploadPausedRef.current = true;
    if (uploadAbortRef.current) uploadAbortRef.current.abort();
  }, []);

  const chooseUploadFile = (file) => {
    if (uploading) return;
    uploadPausedRef.current = false;
    setUploadFile(file || null);
    setUploadMeta(null);
    setUploadProgress(0);
    setUploadedBytes(0);
    setUploadStatus('idle');
    setUploadStatusMessage('');
  };

  const startUpload = async () => {
    if (!uploadFile || uploading) return;
    const file = uploadFile;
    const fingerprint = uploadFingerprint(file);
    uploadPausedRef.current = false;
    setUploading(true);
    setUploadStatus('uploading');
    setUploadStatusMessage('');
    let meta = uploadMeta;
    try {
      let candidateId = meta && meta.id ? meta.id : readUploadId(fingerprint);
      if (candidateId) {
        try {
          const fresh = await api.getUpload(candidateId);
          if (fresh && fresh.status === 'uploading' && fresh.fileName === file.name && Number(fresh.size) === file.size) {
            meta = fresh;
          } else {
            meta = null;
          }
        } catch (error) {
          meta = null;
        }
      }
      if (!meta) {
        meta = await api.initUpload(projectId, {
          fileName: file.name,
          size: file.size,
          chunkSize: UPLOAD_CHUNK_SIZE,
          fingerprint,
        });
        writeUploadId(fingerprint, meta.id);
      }
      setUploadMeta(meta);
      const chunkSize = Number(meta.chunkSize) || UPLOAD_CHUNK_SIZE;
      const received = new Set(Array.isArray(meta.receivedChunks) ? meta.receivedChunks : []);
      let uploaded = 0;
      for (let index = 0; index < meta.totalChunks; index += 1) {
        if (!received.has(index)) continue;
        const start = index * chunkSize;
        uploaded += Math.min(chunkSize, file.size - start);
      }
      setUploadedBytes(uploaded);
      setUploadProgress(file.size > 0 ? Math.min(99, Math.round((uploaded / file.size) * 100)) : 0);
      for (let index = 0; index < meta.totalChunks; index += 1) {
        if (uploadPausedRef.current) break;
        if (received.has(index)) continue;
        const start = index * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const blob = file.slice(start, end);
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        const onProgress = (loaded) => {
          if (file.size <= 0) {
            setUploadProgress(99);
            return;
          }
          setUploadProgress(Math.min(99, Math.round(((uploaded + loaded) / file.size) * 100)));
        };
        await api.uploadChunk(meta.id, index, blob, onProgress, controller.signal);
        received.add(index);
        uploaded += blob.size;
        setUploadedBytes(uploaded);
        setUploadProgress(file.size > 0 ? Math.min(99, Math.round((uploaded / file.size) * 100)) : 99);
        meta = Object.assign({}, meta, { receivedChunks: [...received].sort((left, right) => left - right) });
        setUploadMeta(meta);
      }
      uploadAbortRef.current = null;
      if (uploadPausedRef.current) {
        setUploadStatus('paused');
        setUploading(false);
        return;
      }
      setUploadStatus('completing');
      const completed = await api.completeUpload(meta.id, { addLayer: true });
      const importedCount = Array.isArray(completed && completed.datasets) ? completed.datasets.length : 1;
      writeUploadId(fingerprint, '');
      setUploadMeta(null);
      setUploadFile(null);
      setUploadStatus('done');
      setUploadProgress(100);
      setUploadedBytes(file.size);
      setMessage(importedCount > 1 ? t('dataset.uploadSuccessCount', { count: importedCount }) : t('dataset.uploadSuccess'));
      await loadDatasets();
      if (onChanged) onChanged();
    } catch (reason) {
      if (uploadPausedRef.current || (reason && reason.name === 'AbortError')) {
        setUploadStatus('paused');
        setUploading(false);
        return;
      }
      setUploadStatus('error');
      setUploadStatusMessage(reason instanceof Error ? reason.message : t('dataset.uploadFailed'));
      fail(reason);
    } finally {
      uploadAbortRef.current = null;
      setUploading(false);
    }
  };

  const pauseUpload = () => {
    uploadPausedRef.current = true;
    setUploadStatus('pausing');
    if (uploadAbortRef.current) uploadAbortRef.current.abort();
  };

  const addTile = async () => {
    if (!tileUrl.trim() || busy) return;
    setBusy(true);
    try {
      await api.createTileDataset(projectId, {
        name: tileName.trim() || DEFAULT_LAYER_NAME,
        tileUrl: tileUrl.trim(),
        addLayer: true,
      });
      setMessage(t('dataset.registered'));
      await loadDatasets();
      if (onChanged) onChanged();
    } catch (reason) {
      fail(reason);
    } finally {
      setBusy(false);
    }
  };

  const registerDatabase = async () => {
    if (databaseBusy) return;
    if (!databaseForm.host.trim() || !databaseForm.dbname.trim() || !databaseForm.username.trim()) {
      setDatabaseMessage(t('dataset.dbFailed'));
      return;
    }
    setDatabaseBusy(true);
    setDatabaseMessage(t('dataset.dbConnecting'));
    try {
      const database = await api.createDatabase(projectId, Object.assign({}, databaseForm, {
        name: databaseForm.name.trim() || databaseForm.dbname.trim(),
      }));
      setDatabases((current) => [...current, database]);
      setActiveDatabaseId(database.id);
      setDatabaseForm((current) => Object.assign({}, current, { name: database.name }));
      await loadDatabaseTables(database.id);
      setDatabaseMessage(t('dataset.dbRegistered'));
    } catch (reason) {
      setDatabaseMessage(reason instanceof Error ? reason.message : t('dataset.dbFailed'));
    } finally {
      setDatabaseBusy(false);
    }
  };

  const deleteDatabaseRegistration = async (database) => {
    if (databaseBusy || !database) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('dataset.dbDelete') + '?')) return;
    setDatabaseBusy(true);
    try {
      await api.deleteDatabase(database.id);
      const remaining = databases.filter((item) => item.id !== database.id);
      setDatabases(remaining);
      setActiveDatabaseId(remaining[0] ? remaining[0].id : '');
      setDatabaseTables([]);
    } catch (reason) {
      setDatabaseMessage(reason instanceof Error ? reason.message : t('dataset.dbFailed'));
    } finally {
      setDatabaseBusy(false);
    }
  };

  const importDatabaseTable = async (table) => {
    if (databaseBusy || !activeDatabaseId) return;
    setDatabaseBusy(true);
    setDatabaseMessage('');
    try {
      await api.importDatabaseTable(activeDatabaseId, {
        schema: table.schema,
        table: table.table,
        addLayer: true,
      });
      setDatabaseMessage(t('dataset.dbImported'));
      await loadDatasets();
      if (onChanged) onChanged();
    } catch (reason) {
      fail(reason);
    } finally {
      setDatabaseBusy(false);
    }
  };

  const tabs = [
    ['list', t('dataset.tabList')],
    ['browse', t('dataset.tabBrowse')],
    ['upload', t('dataset.tabUpload')],
    ['database', t('dataset.tabDatabase')],
    ['url', t('dataset.tabUrl')],
  ];

  let body;
  if (tab === 'list') {
    body = h('div', { className: 'gis-dataset-list' },
      datasets.length === 0 ? h('div', { className: 'gis-layer-empty' }, t('dataset.empty')) : null,
      datasets.map((dataset) => h('div', { key: dataset.id, className: 'gis-dataset-card' },
        h('div', { className: 'gis-dataset-icon' }, h(SvgIcon, { name: dataset.kind === 'raster' ? 'image' : dataset.kind === 'vector' ? 'map' : 'database', size: 16 })),
        h('div', { className: 'gis-dataset-copy' },
          h('div', { className: 'gis-dataset-name', title: datasetDisplayName(dataset) }, datasetDisplayName(dataset)),
          h('div', { className: 'gis-dataset-meta' }, datasetMeta(dataset, t)),
          h('div', { className: 'gis-dataset-uri', title: dataset.uri }, dataset.uri),
        ),
        h('div', { className: 'gis-dataset-actions' },
          dataset.kind === 'raster' && dataset.profile && (dataset.profile.format === 'geotiff' || dataset.profile.conversionError || (dataset.profile.format === 'cog' && dataset.profile.renderable === false))
            ? h('button', { type: 'button', className: 'gis-tool-btn is-primary', disabled: busy, onClick: () => convertToCog(dataset) }, t('dataset.convertCog'))
            : h('button', { type: 'button', className: 'gis-tool-btn is-primary', disabled: busy || (dataset.profile && dataset.profile.renderable === false), onClick: () => addDatasetLayer(dataset) }, t('dataset.addLayer')),
          h('button', { type: 'button', className: 'gis-link-button', disabled: busy, onClick: () => removeDataset(dataset) }, t('dataset.delete')),
        ),
      )),
    );
  } else if (tab === 'browse') {
    body = h('div', { className: 'gis-browse' },
      h('div', { className: 'gis-browse-bar' },
        h('button', { type: 'button', className: 'gis-icon-btn gis-icon-btn-sm', title: t('dataset.up'), disabled: !browse || !browse.parent || busy, onClick: () => browse && browse.parent && loadBrowse(browse.parent) }, h(SvgIcon, { name: 'chevron-left', size: 14 })),
        h('input', { className: 'gis-input gis-input-mono', value: browsePath, onChange: (event) => setBrowsePath(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter') loadBrowse(browsePath); } }),
        h('button', { type: 'button', className: 'gis-btn', disabled: busy, onClick: () => loadBrowse(browsePath) }, t('dataset.go')),
      ),
      browse && browse.roots && browse.roots.length > 1 ? h('div', { className: 'gis-browse-roots' },
        browse.roots.map((root) => h('button', {
          key: root,
          type: 'button',
          className: 'gis-root-chip' + (browse.path === root ? ' is-active' : ''),
          onClick: () => loadBrowse(root),
          title: root,
        }, root)),
      ) : null,
      h('div', { className: 'gis-browse-list' },
        !browse && busy ? h('div', { className: 'gis-empty-note' }, t('dataset.loading')) : null,
        browse ? browse.entries.map((entry) => h('button', {
          key: entry.path,
          type: 'button',
          className: 'gis-browse-row' + (selectedFile && selectedFile.path === entry.path ? ' is-selected' : '') + (entry.type === 'file' && !entry.supported ? ' is-disabled' : ''),
          disabled: busy || (entry.type === 'file' && !entry.supported),
          onClick: () => {
            if (entry.type === 'directory') loadBrowse(entry.path);
            else setSelectedFile(entry);
          },
        },
          h('span', { className: 'gis-browse-icon' }, h(SvgIcon, { name: entry.type === 'directory' ? 'folder' : 'file', size: 14 })),
          h('span', { className: 'gis-browse-name' }, entry.name),
          h('span', { className: 'gis-browse-meta' }, entry.type === 'directory' ? '' : (entry.kindHint || 'file') + ' · ' + formatBytes(entry.size)),
        )) : null,
      ),
      h('div', { className: 'gis-browse-foot' },
        h('span', { className: 'gis-selected-path', title: selectedFile ? selectedFile.path : '' }, selectedFile ? t('dataset.selected') + ': ' + selectedFile.name : t('dataset.selectFile')),
        h('button', { type: 'button', className: 'gis-btn gis-btn-primary', disabled: !selectedFile || busy, onClick: registerSelected }, busy ? t('dataset.loading') : t('dataset.register')),
      ),
    );
  } else if (tab === 'upload') {
    const statusText = uploadStatus === 'uploading'
      ? t('dataset.uploading')
      : uploadStatus === 'pausing'
        ? t('dataset.uploading')
        : uploadStatus === 'paused'
          ? t('dataset.paused')
          : uploadStatus === 'completing'
            ? t('dataset.completing')
            : uploadStatus === 'done'
              ? t('dataset.uploadSuccess')
              : uploadStatus === 'error'
                ? (uploadStatusMessage || t('dataset.uploadFailed'))
                : t('dataset.uploadResumable');
    body = h('div', { className: 'gis-upload' },
      h('div', { className: 'gis-layer-empty' },
        h('div', { className: 'gis-layer-empty-title' }, t('dataset.upload')),
        h('div', { className: 'gis-layer-empty-body' }, t('dataset.uploadHint')),
        h('div', { className: 'gis-upload-hint' }, t('dataset.uploadResumable')),
      ),
      h('input', {
        type: 'file',
        className: 'gis-file-input',
        disabled: uploading,
        onChange: (event) => chooseUploadFile(event.target.files && event.target.files[0] ? event.target.files[0] : null),
      }),
      uploadFile || uploadProgress > 0 ? h('div', { className: 'gis-upload-progress' },
        h('div', { className: 'gis-progress-track' },
          h('div', { className: 'gis-progress-fill', style: { width: uploadProgress + '%' } }),
        ),
        h('div', { className: 'gis-progress-meta' },
          t('dataset.uploadProgress', {
            percent: uploadProgress,
            uploaded: formatBytes(uploadedBytes),
            total: formatBytes(uploadFile ? uploadFile.size : uploadedBytes),
          }),
        ),
      ) : null,
      h('div', { className: 'gis-upload-status' + (uploadStatus === 'error' ? ' is-error' : '') }, statusText),
      h('div', { className: 'gis-browse-foot' },
        h('span', { className: 'gis-selected-path' }, uploadFile ? uploadFile.name : t('dataset.selectFile')),
        uploading || uploadStatus === 'pausing'
          ? h('button', { type: 'button', className: 'gis-btn', disabled: uploadStatus === 'pausing', onClick: pauseUpload }, t('dataset.pause'))
          : uploadStatus === 'done'
            ? null
            : h('button', {
              type: 'button',
              className: 'gis-btn gis-btn-primary',
              disabled: !uploadFile || uploadStatus === 'completing',
              onClick: startUpload,
            }, uploadStatus === 'paused' ? t('dataset.resume') : t('dataset.upload')),
      ),
    );
  } else if (tab === 'database') {
    const field = (key, label, options = {}) => h('div', { className: 'gis-db-field' },
      h('label', { className: 'gis-field-label' }, label),
      h('input', Object.assign({}, options, {
        className: 'gis-input' + (options.mono ? ' gis-input-mono' : ''),
        value: databaseForm[key],
        disabled: databaseBusy,
        onChange: (event) => setDatabaseForm((current) => Object.assign({}, current, { [key]: event.target.value })),
      })),
    );
    body = h('div', { className: 'gis-database' },
      h('div', { className: 'gis-db-heading' },
        h('div', { className: 'gis-db-title' }, t('dataset.dbTitle')),
        h('div', { className: 'gis-tool-hint' }, t('dataset.dbHint')),
      ),
      databases.length > 0 ? h('div', { className: 'gis-db-list' },
        h('div', { className: 'gis-field-label' }, t('dataset.dbSelect')),
        databases.map((database) => h('div', { key: database.id, className: 'gis-db-item' + (database.id === activeDatabaseId ? ' is-active' : '') },
          h('button', {
            type: 'button',
            className: 'gis-db-select',
            onClick: () => setActiveDatabaseId(database.id),
            title: database.host + ':' + database.port + '/' + database.dbname,
          }, h(SvgIcon, { name: 'database', size: 13 }), database.name),
          h('button', {
            type: 'button',
            className: 'gis-link-button',
            disabled: databaseBusy,
            onClick: () => deleteDatabaseRegistration(database),
          }, t('dataset.dbDelete')),
        )),
      ) : null,
      h('div', { className: 'gis-db-form' },
        field('name', t('dataset.dbName'), { placeholder: 'gis' }),
        field('host', t('dataset.dbHost'), { placeholder: '127.0.0.1' }),
        field('port', t('dataset.dbPort'), { type: 'number', min: 1, max: 65535 }),
        field('dbname', t('dataset.dbDatabase'), { placeholder: 'gis' }),
        field('username', t('dataset.dbUser'), { placeholder: 'postgres' }),
        field('password', t('dataset.dbPassword'), { type: 'password', autoComplete: 'off' }),
        field('sslmode', t('dataset.dbSsl'), { placeholder: 'prefer' }),
      ),
      h('div', { className: 'gis-browse-foot' },
        h('span', { className: 'gis-db-status' }, databaseBusy ? t('dataset.dbConnecting') : databaseMessage),
        h('button', { type: 'button', className: 'gis-btn gis-btn-primary', disabled: databaseBusy, onClick: registerDatabase }, t('dataset.dbRegister')),
      ),
      activeDatabaseId && databaseTables.length > 0 ? h('div', { className: 'gis-db-tables' },
        h('div', { className: 'gis-field-label' }, t('dataset.dbTables')),
        databaseTables.map((table) => h('div', { key: table.schema + '.' + table.table, className: 'gis-db-table' },
          h('div', { className: 'gis-db-table-copy' },
            h('div', { className: 'gis-db-table-name', title: table.schema + '.' + table.table }, table.schema + '.' + table.table),
            h('div', { className: 'gis-db-table-meta' }, (table.geometryType || 'geometry') + ' · EPSG:' + (table.srid || '?') + ' · ' + t('dataset.dbColumns', { count: table.columns ? table.columns.length : 0 })),
          ),
          h('button', {
            type: 'button',
            className: 'gis-tool-btn is-primary',
            disabled: databaseBusy,
            onClick: () => importDatabaseTable(table),
          }, t('dataset.dbAddTable')),
        )),
      ) : null,
    );
  } else {
    body = h('div', { className: 'gis-upload' },
      h('label', { className: 'gis-field-label' }, t('dataset.urlName')),
      h('input', { className: 'gis-input', value: tileName, onChange: (event) => setTileName(event.target.value) }),
      h('label', { className: 'gis-field-label' }, t('dataset.tabUrl')),
      h('input', { className: 'gis-input gis-input-mono', value: tileUrl, onChange: (event) => setTileUrl(event.target.value), placeholder: t('dataset.urlPlaceholder') }),
      h('div', { className: 'gis-browse-foot' },
        h('span', { className: 'gis-selected-path' }, ''),
        h('button', { type: 'button', className: 'gis-btn gis-btn-primary', disabled: !tileUrl.trim() || busy, onClick: addTile }, busy ? t('dataset.loading') : t('dataset.addUrl')),
      ),
    );
  }

  return h('div', { className: 'gis-modal', onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
    h('div', { className: 'gis-modal-card gis-data-modal' },
      h('div', { className: 'gis-modal-head' },
        h('div', { className: 'gis-modal-title' }, t('dataset.title')),
        h('button', { type: 'button', className: 'gis-icon-btn gis-icon-btn-sm', onClick: onClose, 'aria-label': t('project.cancel') }, h(SvgIcon, { name: 'close', size: 14 })),
      ),
      h('div', { className: 'gis-tabs' },
        tabs.map(([id, label]) => h('button', {
          key: id,
          type: 'button',
          className: 'gis-tab' + (tab === id ? ' is-active' : ''),
          onClick: () => setTab(id),
        }, label)),
      ),
      message ? h('div', { className: 'gis-modal-message' }, message) : null,
      h('div', { className: 'gis-modal-body' }, body),
    ),
  );
}

const TOOL_DEFS = [
  { id: 'layers', key: 'tools.layers', icon: 'layers' },
  { id: 'measure', key: 'tools.measure', icon: 'ruler' },
  { id: 'annotate', key: 'tools.annotate', icon: 'pin' },
  { id: 'analyze', key: 'tools.analyze', icon: 'chart' },
  { id: 'data', key: 'tools.data', icon: 'database' },
];

function Workbench({ runtime, t }) {
  const scheme = useScheme(runtime);
  const layers = useLayerStore();
  const [activeTool, setActiveToolState] = useState('layers');
  const [toast, setToast] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectId, setProjectId] = useState(() => {
    try {
      return window.localStorage.getItem('gis-workbench.project') || '';
    } catch (error) {
      return '';
    }
  });
  const [layerTick, setLayerTick] = useState(0);
  const [dataOpen, setDataOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newVectorOpen, setNewVectorOpen] = useState(false);
  const [drawTarget, setDrawTarget] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [layerMenu, setLayerMenu] = useState(null);
  const [featureMenu, setFeatureMenu] = useState(null);
  const loadedProjectRef = useRef('');
  const [editTarget, setEditTarget] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const showToast = useCallback((message) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(message);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setToast(null);
    }, 2600);
  }, []);

  const chooseTool = useCallback((toolId) => {
    if (toolId === 'layers') {
      setActiveToolState((current) => (current === 'layers' ? 'none' : 'layers'));
      return;
    }
    setActiveToolState(toolId);
    if (toolId === 'analyze') showToast(t('tools.pending'));
  }, [showToast, t]);

  const refreshLayers = useCallback(() => {
    setLayerTick((value) => value + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    api.getBootstrap().then((data) => {
      if (!alive) return;
      const list = Array.isArray(data.projects) ? data.projects : [];
      setProjects(list);
      let stored = '';
      try {
        stored = window.localStorage.getItem('gis-workbench.project') || '';
      } catch (error) {
        stored = '';
      }
      const next = list.some((project) => project.id === stored)
        ? stored
        : (data.defaultProjectId || (list[0] && list[0].id) || '');
      setProjectId(next);
      setProjectLoading(false);
    }).catch((error) => {
      if (!alive) return;
      setProjectLoading(false);
      console.warn('[gis-workbench] could not load projects', error);
      showToast(error instanceof Error ? error.message : t('project.failed'));
    });
    return () => {
      alive = false;
    };
  }, [showToast, t]);

  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  useEffect(() => {
    try {
      if (projectId) window.localStorage.setItem('gis-workbench.project', projectId);
    } catch (error) {
      // Persisting the selected project is best effort.
    }
  }, [projectId]);

  useEffect(() => {
    let alive = true;
    if (!projectId) {
      replaceProjectLayers(null, []);
      loadedProjectRef.current = '';
      return undefined;
    }
    if (loadedProjectRef.current !== projectId) {
      loadedProjectRef.current = projectId;
      replaceProjectLayers(projectId, []);
    }
    api.listLayers(projectId).then((rows) => {
      if (!alive) return;
      replaceProjectLayers(projectId, (rows || []).map((layer) => projectLayerToStore(layer, projectId)));
    }).catch((error) => {
      if (!alive) return;
      console.warn('[gis-workbench] could not load project layers', error);
      showToast(error instanceof Error ? error.message : t('project.failed'));
    });
    return () => {
      alive = false;
    };
  }, [projectId, layerTick, showToast, t]);

  const handleToggleLayer = useCallback((layer) => {
    toggleLayerVisibility(layer.key);
    if (layer.source === 'project' || layer.persisted) setDirty(true);
  }, []);

  const handleRemoveLayer = useCallback((layer) => {
    removeLayer(layer.key);
    if (layer.source === 'project' || layer.persisted) setDirty(true);
  }, []);

  const saveProject = useCallback(async (overrideLayers) => {
    if (!projectId || saving) return false;
    setSaving(true);
    try {
      const sourceLayers = Array.isArray(overrideLayers) ? overrideLayers : layers;
      const projectLayers = sourceLayers
        .filter((layer) => layer.source === 'project')
        .map((layer) => ({
          id: layer.layerId,
          datasetId: layer.datasetId,
          name: layer.name,
          visible: layer.visible,
          z: layer.z,
          style: layer.style || {},
        }));
      await api.saveProjectState(projectId, { layers: projectLayers });
      setDirty(false);
      refreshLayers();
      showToast(t('project.saved'));
      return true;
    } catch (error) {
      showToast((error instanceof Error ? error.message : t('project.saveFailed')));
      return false;
    } finally {
      setSaving(false);
    }
  }, [projectId, saving, layers, refreshLayers, showToast, t]);

  const handleReorderLayers = useCallback((sourceKey, targetKey, after) => {
    const source = layers.find((layer) => layer.key === sourceKey);
    const target = layers.find((layer) => layer.key === targetKey);
    if (!reorderLayers(sourceKey, targetKey, after)) return;
    if ((source && (source.source === 'project' || source.persisted)) || (target && (target.source === 'project' || target.persisted))) {
      setDirty(true);
      void saveProject(getLayers());
    }
  }, [layers, saveProject]);

  const openNewVectorLayer = useCallback(async () => {
    if (!projectId) {
      showToast(t('dataset.noProject'));
      return;
    }
    if (dirty && !(await saveProject())) return;
    setNewVectorOpen(true);
  }, [projectId, dirty, saveProject, showToast, t]);

  const createVectorLayer = useCallback(async (name) => {
    if (!projectId) throw new Error(t('dataset.noProject'));
    const result = await api.createVectorLayer(projectId, { name });
    setEditTarget(null);
    setDrawTarget({
      datasetId: result.dataset.id,
      layerId: result.layer && result.layer.id,
      name: result.dataset.profile && result.dataset.profile.name ? result.dataset.profile.name : name,
    });
    setActiveToolState('layers');
    refreshLayers();
    showToast(t('layers.newVector'));
  }, [projectId, refreshLayers, showToast, t]);

  const savePolygon = useCallback(async (target, geometry) => {
    if (!target) throw new Error(t('layers.drawFailed'));
    const dataset = await api.addVectorFeature(target.datasetId, { geometry });
    setDrawTarget(null);
    refreshLayers();
    showToast(t('layers.drawSaved'));
    return dataset;
  }, [refreshLayers, showToast, t]);

  const cancelDraw = useCallback(() => {
    setDrawTarget(null);
  }, []);

  const editVectorLayer = useCallback(async (layer) => {
    if (!layer || !layer.datasetId) return;
    if (dirty && !(await saveProject())) return;
    setDrawTarget(null);
    setEditTarget({ datasetId: layer.datasetId, layerId: layer.layerId, name: layer.name });
    setActiveToolState('layers');
  }, [dirty, saveProject]);

  const appendVectorLayer = useCallback(async (target) => {
    if (!target || !target.datasetId) return;
    if (dirty && !(await saveProject())) return;
    setEditTarget(null);
    setDrawTarget({ datasetId: target.datasetId, layerId: target.layerId, name: target.name });
    setActiveToolState('layers');
  }, [dirty, saveProject]);

  const updatePolygon = useCallback(async (target, feature, ring) => {
    if (!target || !feature) throw new Error(t('layers.featureUpdateFailed'));
    const dataset = await api.updateVectorFeature(target.datasetId, {
      name: feature.name,
      createdAt: feature.createdAt,
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
    refreshLayers();
    showToast(t('layers.featureUpdated'));
    return dataset;
  }, [refreshLayers, showToast, t]);

  const cancelEdit = useCallback(() => {
    setEditTarget(null);
  }, []);

  const changeProject = useCallback(async (next) => {
    if (!next || next === projectId) return;
    if (dirty && !(await saveProject())) return;
    setDrawTarget(null);
    setEditTarget(null);
    setProjectId(next);
    setDirty(false);
  }, [projectId, dirty, saveProject]);

  const openDataManager = useCallback(async () => {
    if (!projectId) {
      showToast(t('dataset.noProject'));
      return;
    }
    if (dirty && !(await saveProject())) return;
    setDataOpen(true);
  }, [projectId, dirty, saveProject, showToast, t]);

  const handleExit = useCallback(async () => {
    if (dirty && !(await saveProject())) return;
    exitWorkbench(runtime);
  }, [dirty, saveProject, runtime]);

  const handleSaveLayer = useCallback(async (layer) => {
    if (!projectId) {
      showToast(t('dataset.noProject'));
      return;
    }
    if (!layer.tileUrl) {
      showToast(t('dataset.failed'));
      return;
    }
    if (dirty && !(await saveProject())) return;
    try {
      await api.createTileDataset(projectId, {
        name: layer.name,
        tileUrl: layer.tileUrl,
        tileSize: layer.tileSize,
        attribution: layer.attribution,
        addLayer: true,
      });
      removeLayer(layer.key);
      refreshLayers();
      showToast(t('layers.added'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('dataset.failed'));
    }
  }, [projectId, dirty, saveProject, refreshLayers, showToast, t]);

  const createProject = useCallback(async (name) => {
    if (dirty && !(await saveProject())) throw new Error(t('project.saveFailed'));
    const project = await api.createProject({ name });
    setProjects((current) => [...current, project]);
    setDrawTarget(null);
    setEditTarget(null);
    setProjectId(project.id);
    showToast(t('project.created'));
  }, [dirty, saveProject, showToast, t]);

  const activeProject = projects.find((project) => project.id === projectId);
  const projectName = activeProject ? activeProject.name : '';

  useEffect(() => {
    if ((!layerMenu && !featureMenu) || typeof window === 'undefined') return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setLayerMenu(null);
        setFeatureMenu(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layerMenu, featureMenu]);

  const handleChat = () => {
    if (!toggleChatPanel(runtime)) showToast(t('chat.unavailable'));
  };

  return h('div', { className: 'gis-workbench' + (scheme === 'dark' ? ' gis-dark' : '') },
    h(GisStyle, { withMap: true }),
    h('header', { className: 'gis-topbar' },
      h('div', { className: 'gis-brand' },
        h('span', { className: 'gis-brand-mark' }, h(SvgIcon, { name: 'map', size: 19 })),
        h('div', { className: 'gis-brand-text' },
          h('span', { className: 'gis-brand-title' }, t('mode.workbench')),
          h('span', { className: 'gis-brand-sub' }, t('brand.sub')),
        ),
      ),
      h('div', { className: 'gis-topbar-center' },
        h('div', { className: 'gis-project-control' },
          h(SvgIcon, { name: 'folder', size: 14 }),
          h('select', {
            className: 'gis-project-select',
            value: projectId,
            disabled: projectLoading,
            title: t('project.select'),
            onChange: (event) => changeProject(event.target.value),
          },
            projectLoading
              ? h('option', { value: '' }, t('project.loading'))
              : projects.length > 0
                ? projects.map((project) => h('option', { key: project.id, value: project.id }, project.name))
                : h('option', { value: '' }, t('project.none')),
          ),
          h('button', {
            type: 'button',
            className: 'gis-icon-btn gis-icon-btn-sm',
            title: t('project.new'),
            'aria-label': t('project.new'),
            onClick: () => setNewProjectOpen(true),
          }, h(SvgIcon, { name: 'plus', size: 13 })),
        ),
        h('span', { className: 'gis-mode-chip' },
          h('span', { className: 'gis-mode-dot' }),
          t('mode.badge'),
        ),
        h('span', { className: 'gis-topbar-meta' }, t('mode.framework') + ' · ' + t('topbar.stats', { layers: layers.length })),
      ),
      h('div', { className: 'gis-topbar-actions' },
        h('button', {
          type: 'button',
          className: 'gis-btn' + (dirty ? ' gis-save-button is-dirty' : ' gis-save-button'),
          onClick: saveProject,
          disabled: !projectId || saving,
          title: dirty ? t('project.unsaved') : t('project.save'),
          'aria-label': t('project.save'),
        },
          h(SvgIcon, { name: 'save', size: 15 }),
          h('span', { className: 'gis-btn-label' }, saving ? t('project.saving') : t('project.save')),
          dirty ? h('span', { className: 'gis-save-dot' }) : null,
        ),
        h('button', {
          type: 'button',
          className: 'gis-btn',
          onClick: handleChat,
          title: t('chat.toggle'),
          'aria-label': t('chat.toggle'),
        },
          h(SvgIcon, { name: 'chat', size: 15 }),
          h('span', { className: 'gis-btn-label' }, t('chat.toggle')),
        ),
        h('button', {
          type: 'button',
          className: 'gis-btn gis-btn-primary',
          onClick: handleExit,
          title: t('mode.exit'),
          'aria-label': t('mode.exit'),
        },
          h(SvgIcon, { name: 'layout', size: 15 }),
          h('span', { className: 'gis-btn-label' }, t('mode.original')),
        ),
      ),
    ),
    h('div', { className: 'gis-main' },
      h('aside', { className: 'gis-rail', 'aria-label': t('tools.title') },
        TOOL_DEFS.map((tool) => h('button', {
          key: tool.id,
          type: 'button',
          className: 'gis-rail-btn' + (tool.id === 'data' ? (dataOpen ? ' is-active' : '') : (activeTool === tool.id ? ' is-active' : '')),
          title: t(tool.key),
          'aria-label': t(tool.key),
          'aria-pressed': tool.id === 'data' ? dataOpen : activeTool === tool.id,
          onClick: () => {
            if (tool.id === 'data') openDataManager();
            else chooseTool(tool.id);
          },
        }, h(SvgIcon, { name: tool.icon, size: 18 }))),
        h('div', { className: 'gis-rail-divider' }),
        h('div', { className: 'gis-rail-foot', title: t('mode.framework') },
          h('span', { className: 'gis-rail-dot' }),
          h('span', { className: 'gis-rail-version' }, 'v0.2'),
        ),
      ),
      h('div', { className: 'gis-stage' },
        h(MapCanvas, {
          runtime,
          t,
          activeTool,
          onToggleLayer: handleToggleLayer,
          onRemoveLayer: handleRemoveLayer,
          onSaveLayer: handleSaveLayer,
          onReorderLayers: handleReorderLayers,
          onNotify: showToast,
          drawTarget,
          onSavePolygon: savePolygon,
          onCancelDraw: cancelDraw,
          onNewVectorLayer: openNewVectorLayer,
          onEditLayer: editVectorLayer,
          onAppendLayer: appendVectorLayer,
          onRefreshLayers: refreshLayers,
          editTarget,
          onUpdateFeature: updatePolygon,
          onCancelEdit: cancelEdit,
          onLayerMenu: (event, layer) => { setFeatureMenu(null); setLayerMenu({ x: event.clientX, y: event.clientY, layer }); },
          onFeatureMenu: (x, y, layer, feature) => { setLayerMenu(null); setFeatureMenu({ x, y, layer, feature }); },
          projectName,
        }),
        toast ? h('div', { className: 'gis-toast', role: 'status' }, toast) : null,
      ),
    ),
    newProjectOpen
      ? h(NewProjectDialog, { t, onClose: () => setNewProjectOpen(false), onCreate: createProject })
      : null,
    newVectorOpen
      ? h(NewVectorLayerDialog, { t, onClose: () => setNewVectorOpen(false), onCreate: createVectorLayer })
      : null,
    dataOpen && projectId
      ? h(DatasetManager, {
        projectId,
        t,
        onClose: () => setDataOpen(false),
        onChanged: refreshLayers,
        notify: showToast,
      })
      : null,
    layerMenu
      ? h(React.Fragment, null,
        h('div', {
          className: 'gis-context-backdrop',
          onClick: () => setLayerMenu(null),
          onContextMenu: (event) => { event.preventDefault(); setLayerMenu(null); },
        }),
        h('div', {
          className: 'gis-context-menu',
          style: {
            left: Math.max(8, Math.min(layerMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 252)) + 'px',
            top: Math.max(8, Math.min(layerMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 96)) + 'px',
          },
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'gis-context-title', title: layerMenu.layer.name }, layerMenu.layer.name),
          h('button', {
            type: 'button',
            className: 'gis-context-action',
            onClick: async () => {
              const layer = layerMenu.layer;
              setLayerMenu(null);
              const ok = await appendToConversation(runtime, buildLayerPrompt(layer, projectName));
              showToast(ok ? t('layers.addedToChat') : t('layers.chatUnavailable'));
            },
          }, h(SvgIcon, { name: 'chat', size: 13 }), t('layers.addToChat')),
        ),
      )
      : null,
    featureMenu
      ? h(React.Fragment, null,
        h('div', {
          className: 'gis-context-backdrop',
          onClick: () => setFeatureMenu(null),
          onContextMenu: (event) => { event.preventDefault(); setFeatureMenu(null); },
        }),
        h('div', {
          className: 'gis-context-menu',
          style: {
            left: Math.max(8, Math.min(featureMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 252)) + 'px',
            top: Math.max(8, Math.min(featureMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 110)) + 'px',
          },
          onClick: (event) => event.stopPropagation(),
        },
          h('div', { className: 'gis-context-title' }, featureMenu.feature.name || t('layers.polygon')),
          h('div', { className: 'gis-context-subtitle' }, featureMenu.layer.name),
          h('button', {
            type: 'button',
            className: 'gis-context-action is-danger',
            onClick: async () => {
              const item = featureMenu;
              setFeatureMenu(null);
              try {
                await api.deleteVectorFeature(item.layer.datasetId, {
                  name: item.feature.name,
                  createdAt: item.feature.createdAt,
                });
                refreshLayers();
                showToast(t('layers.featureDeleted'));
              } catch (error) {
                showToast(error instanceof Error ? error.message : t('layers.featureDeleteFailed'));
              }
            },
          }, h(SvgIcon, { name: 'trash', size: 13 }), t('layers.deleteFeature')),
        ),
      )
      : null,
  );
}

function WorkbenchOverlay({ runtime, t }) {
  const open = useWorkbenchOpen();
  const [right, setRight] = useState(0);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const column = document.querySelector('[data-rightbar-col]');
    if (!column) {
      setRight(0);
      return undefined;
    }
    const measure = () => setRight(Math.max(0, Math.round(column.getBoundingClientRect().width)));
    measure();
    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(column);
    }
    window.addEventListener('resize', measure);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  if (!open) return null;
  return h('div', {
    className: 'gis-overlay',
    style: { right: right + 'px' },
    role: 'region',
    'aria-label': t('mode.workbench'),
  }, h(Workbench, { runtime, t }));
}

function GisFixedChatView(props) {
  return props.renderSlot('conversation.session', { view: 'chat' });
}

function GisChatTab({ runtime, t, sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
  const session = useSession ? useSession((value) => value) : undefined;
  const conversation = useConversation ? useConversation((value) => value) : undefined;
  const summaryBlank = useSessions ? useSessions((state) => (sessionId && state.byId[sessionId] ? state.byId[sessionId].blank : undefined)) : undefined;

  const collapse = () => {
    try {
      if (runtime.sidebarRight.isExpanded()) runtime.sidebarRight.toggleExpanded();
    } catch (error) {
      console.warn('[gis-workbench] could not collapse the conversation panel', error);
    }
  };

  const top = h('div', { className: 'gis-chat-top' },
    h('span', { className: 'gis-chat-status-dot' }),
    h('div', { className: 'gis-chat-meta' },
      h('span', { className: 'gis-chat-title' }, t('chat.title')),
      h('span', { className: 'gis-chat-sub' }, t('chat.subtitle')),
    ),
    h('button', {
      type: 'button',
      className: 'gis-chat-collapse',
      title: t('chat.collapse'),
      'aria-label': t('chat.collapse'),
      onClick: collapse,
    }, h(SvgIcon, { name: 'chevron-right', size: 15 })),
  );

  if (!session || !renderFactorySlot) {
    return h('div', { className: 'gis-chat-wrap' }, h(GisStyle, null), top, h('div', { className: 'gis-chat-empty' }, t('chat.noSession')));
  }

  const active = conversation && conversation.activeTargets && conversation.activeTargets.size > 0;
  const phase = active || (!session.blank && !session.awaitingFirstTurn) || session.running
    ? 'active'
    : session.promptAttempted
      ? 'engaging'
      : 'blank';
  const settling = phase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
  const hero = phase === 'blank' && (session.openState === 'open' || summaryBlank === true);

  let content = null;
  try {
    content = renderFactorySlot('conversation.content', {
      variant: 'embedded',
      phase: settling ? 'settling' : hero ? 'hero' : 'active',
      hero,
    }, {
      slots: { views: GisFixedChatView },
    });
  } catch (error) {
    console.error('[gis-workbench] could not render the embedded conversation', error);
  }

  return h('div', { className: 'gis-chat-wrap' },
    h(GisStyle, null),
    top,
    h('div', { className: 'gis-chat-body' },
      content
        ? h(ChatBoundary, { fallback: t('chat.unavailable') }, content)
        : h('div', { className: 'gis-chat-empty' }, t('chat.unavailable')),
    ),
  );
}

function WorkbenchLauncher({ runtime, t, sessionId }) {
  return h(React.Fragment, null,
    h(GisStyle, null),
    h('button', {
      type: 'button',
      className: 'gis-launcher',
      title: t('mode.enter'),
      'aria-label': t('mode.enter'),
      onClick: () => enterWorkbench(runtime, sessionId),
    },
      h(SvgIcon, { name: 'map', size: 13 }),
      h('span', null, 'GIS'),
    ),
  );
}

function argText(block, key) {
  try {
    return block && block.args && block.args.text ? block.args.text(key) : undefined;
  } catch (error) {
    return undefined;
  }
}

function argNumber(block, key, fallback) {
  try {
    const value = block && block.args && block.args.value ? block.args.value(key) : undefined;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch (error) {
    return fallback;
  }
}

function argValue(block, key) {
  try {
    return block && block.args && block.args.value ? block.args.value(key) : undefined;
  } catch (error) {
    return undefined;
  }
}

function StyleToolView({ runtime, t, phase, block, callId, sessionId }) {
  const layerId = argText(block, 'layerId') || '';
  const stylePatch = argValue(block, 'stylePatch');
  const isResult = phase === 'result';
  const isError = isResult && Boolean(block && block.isError);
  const shouldApply = isResult && !isError && layerId && stylePatch && typeof stylePatch === 'object';
  const [applied, setApplied] = React.useState(false);

  useEffect(() => {
    if (!shouldApply) return;
    const changed = updateProjectLayerStyle(layerId, stylePatch);
    setApplied(changed);
  }, [shouldApply, layerId, JSON.stringify(stylePatch)]);

  let stateText = t('gis.style.updating');
  let stateClass = '';
  if (isError) {
    stateText = t('gis.style.failed');
    stateClass = ' is-error';
  } else if (isResult) {
    stateText = applied ? t('gis.style.updated') : t('gis.style.savedOnly');
    stateClass = ' is-ok';
  }
  const errorText = isError
    ? (block && block.error && (block.error.reason || block.error.code || block.error.name)) || t('gis.style.errorFallback')
    : null;
  const summary = stylePatch && typeof stylePatch === 'object' ? JSON.stringify(stylePatch) : '';

  return h('div', { className: 'gis-tool-card' },
    h(GisStyle, null),
    h('div', { className: 'gis-tool-head' },
      h('div', { className: 'gis-tool-icon' }, h(SvgIcon, { name: 'layers', size: 15 })),
      h('div', { className: 'gis-tool-copy' },
        h('div', { className: 'gis-tool-title' }, t('gis.style.title')),
        h('div', { className: 'gis-tool-sub' }, layerId || ''),
      ),
      h('span', { className: 'gis-tool-state' + stateClass }, stateText),
    ),
    h('div', { className: 'gis-tool-body' },
      summary ? h('div', { className: 'gis-tool-url', title: summary }, summary.slice(0, 220)) : null,
      errorText ? h('div', { className: 'gis-tool-error' }, errorText) : null,
      !isResult ? h('div', { className: 'gis-tool-sub' }, t('gis.style.pendingHint')) : null,
    ),
  );
}

function AddLayerToolView({ runtime, t, phase, block, callId, sessionId }) {
  const layers = useLayerStore();
  const name = (argText(block, 'name') || t('gis.tool.defaultName')).trim() || t('gis.tool.defaultName');
  const rawTileUrl = argText(block, 'tileUrl') || DEFAULT_TILE_URL;
  const tileUrl = String(rawTileUrl).trim() || DEFAULT_TILE_URL;
  const tileSize = argNumber(block, 'tileSize', DEFAULT_TILE_SIZE) === 512 ? 512 : DEFAULT_TILE_SIZE;
  const minzoom = clamp(argNumber(block, 'minzoom', 0), 0, 24);
  const maxzoom = Math.max(minzoom, clamp(argNumber(block, 'maxzoom', 18), 0, 24));
  const attribution = argText(block, 'attribution') || DEFAULT_ATTRIBUTION;
  const isResult = phase === 'result';
  const isError = isResult && Boolean(block && block.isError);
  const shouldAdd = isResult && !isError;
  const added = layers.find((layer) => layer.tileUrl === tileUrl);
  const showAdded = shouldAdd && Boolean(added);

  useEffect(() => {
    if (!shouldAdd) return;
    addLayer({
      key: 'tool:' + callId,
      name,
      tileUrl,
      tileSize,
      minzoom,
      maxzoom,
      attribution,
      source: 'conversation',
    });
  }, [shouldAdd, callId, name, tileUrl, tileSize, minzoom, maxzoom, attribution]);

  let stateText = t('gis.tool.preparing');
  let stateClass = '';
  if (phase === 'start') stateText = t('gis.tool.adding');
  if (isError) {
    stateText = t('gis.tool.failed');
    stateClass = ' is-error';
  } else if (isResult) {
    stateText = t('gis.tool.added');
    stateClass = ' is-ok';
  }

  const errorText = isError
    ? (block && block.error && (block.error.reason || block.error.code || block.error.name)) || t('gis.tool.errorFallback')
    : null;

  return h('div', { className: 'gis-tool-card' },
    h(GisStyle, null),
    h('div', { className: 'gis-tool-head' },
      h('div', { className: 'gis-tool-icon' }, h(SvgIcon, { name: 'layers', size: 15 })),
      h('div', { className: 'gis-tool-copy' },
        h('div', { className: 'gis-tool-title' }, t('gis.tool.title')),
        h('div', { className: 'gis-tool-sub' }, name),
      ),
      h('span', { className: 'gis-tool-state' + stateClass }, stateText),
    ),
    h('div', { className: 'gis-tool-body' },
      h('div', { className: 'gis-tool-url', title: tileUrl }, tileUrl),
      errorText ? h('div', { className: 'gis-tool-error' }, errorText) : null,
      h('div', { className: 'gis-tool-actions' },
        showAdded ? h('button', {
          type: 'button',
          className: 'gis-tool-btn is-primary',
          onClick: () => enterWorkbench(runtime, sessionId),
        }, h(SvgIcon, { name: 'map', size: 12 }), t('gis.tool.viewMap')) : null,
        !isResult ? h('span', { className: 'gis-tool-sub' }, t('gis.tool.pendingHint')) : null,
      ),
    ),
  );
}

/** Client-side fallback so a place-only call still moves the camera. */
const PLACE_COORDS = {
  hangzhou: [120.1551, 30.2741], '杭州': [120.1551, 30.2741],
  beijing: [116.4074, 39.9042], '北京': [116.4074, 39.9042],
  shanghai: [121.4737, 31.2304], '上海': [121.4737, 31.2304],
  shenzhen: [114.0579, 22.5431], '深圳': [114.0579, 22.5431],
  guangzhou: [113.2644, 23.1291], '广州': [113.2644, 23.1291],
  chengdu: [104.0665, 30.5723], '成都': [104.0665, 30.5723],
  xian: [108.9398, 34.3416], '西安': [108.9398, 34.3416],
  china: [104.2, 35.5], '中国': [104.2, 35.5],
};

function readViewArgs(block) {
  let center = null;
  try {
    const raw = block && block.args && block.args.value ? block.args.value('center') : undefined;
    if (Array.isArray(raw) && raw.length >= 2) center = [Number(raw[0]), Number(raw[1])];
  } catch (error) {
    center = null;
  }
  const place = (argText(block, 'place') || '').trim().toLowerCase();
  if ((!center || !Number.isFinite(center[0]) || !Number.isFinite(center[1])) && place) {
    const preset = PLACE_COORDS[place];
    if (preset) center = preset.slice();
  }
  const label = (argText(block, 'label') || argText(block, 'place') || '').trim();
  return { center, zoom: argNumber(block, 'zoom', 11), label };
}

function SetViewToolView({ runtime, t, phase, block, callId, sessionId }) {
  const { center, zoom, label } = readViewArgs(block);
  const isResult = phase === 'result';
  const isError = isResult && Boolean(block && block.isError);
  const shouldApply = isResult && !isError && Array.isArray(center);
  const valid = Array.isArray(center) && Number.isFinite(center[0]) && Number.isFinite(center[1]);

  useEffect(() => {
    if (!shouldApply) return;
    setView({ key: 'tool:' + callId, center, zoom, label });
  }, [shouldApply, callId, zoom, label, center ? center[0] : null, center ? center[1] : null]);

  let stateText = t('gis.view.locating');
  let stateClass = '';
  if (isError) {
    stateText = t('gis.view.failed');
    stateClass = ' is-error';
  } else if (isResult) {
    stateText = t('gis.view.located');
    stateClass = ' is-ok';
  }

  const coords = valid
    ? center[1].toFixed(4) + '°N, ' + center[0].toFixed(4) + '°E'
    : t('gis.view.errorFallback');

  return h('div', { className: 'gis-tool-card' },
    h(GisStyle, null),
    h('div', { className: 'gis-tool-head' },
      h('div', { className: 'gis-tool-icon' }, h(SvgIcon, { name: 'map', size: 15 })),
      h('div', { className: 'gis-tool-copy' },
        h('div', { className: 'gis-tool-title' }, t('gis.view.title')),
        h('div', { className: 'gis-tool-sub' }, label || t('gis.view.defaultLabel')),
      ),
      h('span', { className: 'gis-tool-state' + stateClass }, stateText),
    ),
    h('div', { className: 'gis-tool-body' },
      h('div', { className: 'gis-tool-url' }, coords + ' · z' + Number(zoom).toFixed(1)),
      h('div', { className: 'gis-tool-actions' },
        isResult ? h('button', {
          type: 'button',
          className: 'gis-tool-btn is-primary',
          onClick: () => enterWorkbench(runtime, sessionId),
        }, h(SvgIcon, { name: 'map', size: 12 }), t('gis.tool.viewMap')) : null,
        !isResult ? h('span', { className: 'gis-tool-sub' }, t('gis.view.pendingHint')) : null,
      ),
    ),
  );
}

function makeStyleToolView(runtime, t) {
  return function GisStyleToolView(props) {
    return h(StyleToolView, Object.assign({}, props, { runtime, t: props.t || t }));
  };
}

function makeViewToolView(runtime, t) {
  return function GisSetViewToolView(props) {
    return h(SetViewToolView, Object.assign({}, props, { runtime, t: props.t || t }));
  };
}

function makeOverlay(runtime, t) {
  return function GisWorkbenchOverlay(props) {
    return h(WorkbenchOverlay, { runtime, t: props.t || t });
  };
}

function makeChatTab(runtime, t) {
  return function GisChatTabEntry(props) {
    return h(GisChatTab, Object.assign({}, props, { runtime, t: props.t || t }));
  };
}

function makeLauncher(runtime, t) {
  return function GisWorkbenchLauncher(props) {
    return h(WorkbenchLauncher, Object.assign({}, props, { runtime, t: props.t || t }));
  };
}

function makeToolView(runtime, t) {
  return function GisAddLayerToolView(props) {
    return h(AddLayerToolView, Object.assign({}, props, { runtime, t: props.t || t }));
  };
}

let priorRightbar = null;
const mapSessions = new Map();
let activeAnchorSessionId;
let activeMapSessionId;
let workbenchEpoch = 0;
let chatTabTitle = '地图对话';
const composerActions = new Map();

function buildLayerPrompt(layer, projectName) {
  const lines = ['图层：' + (layer.name || '未命名图层')];
  if (layer.layerId) lines.push('layerId：' + layer.layerId);
  else if (layer.key) lines.push('layerKey：' + layer.key);
  if (layer.projectId) lines.push('projectId：' + layer.projectId);
  if (projectName) lines.push('项目：' + projectName);
  const promptFormat = layer.sourceFormat === 'postgis' ? 'pg数据库' : layer.format;
  if (layer.datasetKind) lines.push('类型：' + layer.datasetKind + (promptFormat ? ' / ' + promptFormat : ''));
  if (Number.isFinite(Number(layer.featureCount))) lines.push('要素数：' + layer.featureCount);
  if (Array.isArray(layer.fields) && layer.fields.length > 0) lines.push('字段：' + layer.fields.join(', '));
  if (Array.isArray(layer.bbox) && layer.bbox.length === 4) {
    lines.push('范围：' + layer.bbox.map((value) => Number(value).toFixed(6)).join(', '));
  }
  if (layer.style && typeof layer.style === 'object' && Object.keys(layer.style).length > 0) {
    const text = JSON.stringify(layer.style);
    if (text.length <= 320) lines.push('当前样式：' + text);
  }
  lines.push('', '请基于该图层：');
  return lines.join('\n');
}

function appendChatDraft(sessionId, text) {
  const entry = composerActions.get(sessionId);
  if (!entry) return false;
  const current = String(entry.draft || '');
  const next = current.trim()
    ? current.replace(/\s+$/, '') + '\n\n' + text
    : text;
  entry.inputActions.setDraft(next);
  return true;
}

async function appendToConversation(runtime, text) {
  const sessionId = activeMapSessionId || activeAnchorSessionId;
  if (!sessionId) return false;
  try {
    openChat(runtime, sessionId);
  } catch (error) {
    // Retry below; the composer may mount shortly.
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (appendChatDraft(sessionId, text)) return true;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return false;
}

function ComposerDraftBridge({ sessionId, inputActions, useInput }) {
  const draft = useInput((state) => state.draft);
  useEffect(() => {
    if (!sessionId || !inputActions) return undefined;
    composerActions.set(sessionId, { inputActions, draft });
    return undefined;
  }, [sessionId, inputActions, draft]);
  return null;
}

function makeComposerBridge(runtime, t) {
  return function GisComposerBridge(props) {
    return h(ComposerDraftBridge, Object.assign({}, props, { runtime, t: props.t || t }));
  };
}


function ensureChatTabType(runtime) {
  const tabs = runtime.get('sidebarRightTabs');
  if (!tabs || typeof tabs.register !== 'function') return false;
  try {
    if (typeof tabs.get === 'function' && tabs.get(CHAT_KIND)) return true;
  } catch (error) {
    // Fall through and try to register.
  }
  try {
    const dispose = tabs.register({
      id: CHAT_ID,
      kind: CHAT_KIND,
      title: () => chatTabTitle,
    });
    if (typeof runtime.effect === 'function') runtime.effect(() => dispose);
    return true;
  } catch (error) {
    console.error('[gis-workbench] could not register the conversation tab type on demand', error);
    return false;
  }
}

function openChat(runtime, targetSessionId) {
  ensureChatTabType(runtime);
  try {
    const sidebar = runtime.sidebarRight;
    const mounted = sidebar.mounted && sidebar.mounted.getSnapshot ? sidebar.mounted.getSnapshot() : undefined;
    if (targetSessionId && mounted !== targetSessionId && typeof sidebar.openTabIn === 'function') {
      sidebar.openTabIn(targetSessionId, CHAT_KIND);
      return true;
    }
    const tabs = sidebar.openTabs && sidebar.openTabs.getSnapshot ? sidebar.openTabs.getSnapshot() : [];
    const existing = tabs.find((tab) => tab.kind === CHAT_KIND);
    if (existing) {
      if (!sidebar.isExpanded()) sidebar.toggleExpanded();
      try {
        sidebar.focus(existing.id);
      } catch (error) {
        // Focusing is best effort.
      }
      return true;
    }
    sidebar.openTab(CHAT_KIND);
    if (!sidebar.isExpanded()) sidebar.toggleExpanded();
    return true;
  } catch (error) {
    console.warn('[gis-workbench] could not open the conversation panel', error);
    return false;
  }
}

function activateMapChat(runtime, mapSessionId) {
  if (!mapSessionId) return;
  const attempt = () => {
    if (!workbenchOpen || activeMapSessionId !== mapSessionId) return;
    try {
      const sidebar = runtime.sidebarRight;
      if (typeof sidebar.openTabIn === 'function') sidebar.openTabIn(mapSessionId, CHAT_KIND);
    } catch (error) {
      console.warn('[gis-workbench] could not target the map session tab', error);
    }
    openChat(runtime, mapSessionId);
  };
  attempt();
  setTimeout(attempt, 120);
  setTimeout(attempt, 320);
  setTimeout(attempt, 760);
  setTimeout(attempt, 1500);
  setTimeout(attempt, 3000);
}

function closeChat(runtime) {
  try {
    const sidebar = runtime.sidebarRight;
    const tabs = sidebar.openTabs && sidebar.openTabs.getSnapshot ? sidebar.openTabs.getSnapshot() : [];
    for (const tab of tabs) {
      if (tab.kind !== CHAT_KIND) continue;
      try {
        sidebar.close(tab.id);
      } catch (error) {
        console.warn('[gis-workbench] could not close the conversation tab', error);
      }
    }
  } catch (error) {
    console.warn('[gis-workbench] could not inspect the conversation tabs', error);
  }
}

function toggleChatPanel(runtime) {
  if (!activeMapSessionId) return false;
  ensureChatTabType(runtime);
  try {
    const sidebar = runtime.sidebarRight;
    const tabs = sidebar.openTabs && sidebar.openTabs.getSnapshot ? sidebar.openTabs.getSnapshot() : [];
    const existing = tabs.find((tab) => tab.kind === CHAT_KIND);
    if (existing) {
      const active = sidebar.active();
      if (sidebar.isExpanded()) {
        if (active && active.id === existing.id) sidebar.toggleExpanded();
        else sidebar.focus(existing.id);
      } else {
        sidebar.toggleExpanded();
        sidebar.focus(existing.id);
      }
      return true;
    }
    return openChat(runtime, activeMapSessionId);
  } catch (error) {
    console.warn('[gis-workbench] could not toggle the conversation panel', error);
    return false;
  }
}

function workspaceIdOf(runtime, sessionId) {
  try {
    const workspaces = runtime.get('workspaces');
    const snapshot = workspaces && workspaces.list && workspaces.list.getSnapshot ? workspaces.list.getSnapshot() : undefined;
    const items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
    const workspace = items.find((item) => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId));
    return workspace ? workspace.workspaceId : undefined;
  } catch (error) {
    return undefined;
  }
}

async function ensureMapSession(runtime, anchorSessionId) {
  const uiWorkspace = runtime.get('uiWorkspace');
  const sessions = runtime.get('sessions');
  const workspaceId = workspaceIdOf(runtime, anchorSessionId);
  if (!uiWorkspace || typeof uiWorkspace.connectWorkspace !== 'function' || !sessions || !workspaceId) {
    return anchorSessionId;
  }
  const cached = mapSessions.get(workspaceId);
  if (cached) {
    try {
      if (sessions.binding(cached)) return cached;
    } catch (error) {
      // The previous map session is gone; create another.
    }
  }
  const created = await uiWorkspace.connectWorkspace(workspaceId);
  if (created && created === anchorSessionId && typeof sessions.fork === 'function') {
    try {
      const forked = await sessions.fork({ sessionId: anchorSessionId, increaseTitle: false });
      if (forked) {
        mapSessions.set(workspaceId, forked);
        tagMapSession(sessions, forked);
        return forked;
      }
    } catch (error) {
      console.warn('[gis-workbench] could not fork a separate map session', error);
    }
  }
  if (created) {
    mapSessions.set(workspaceId, created);
    tagMapSession(sessions, created);
    return created;
  }
  return anchorSessionId;
}

function tagMapSession(sessions, sessionId) {
  try {
    const session = sessions.binding(sessionId) && sessions.binding(sessionId).session;
    if (session && typeof session.rename === 'function') {
      session.rename('地图会话').catch((error) => {
        console.warn('[gis-workbench] could not name the map session', error);
      });
    }
  } catch (error) {
    console.warn('[gis-workbench] could not name the map session', error);
  }
}

function waitForMounted(runtime, sessionId, timeoutMs) {
  return new Promise((resolve) => {
    const mounted = runtime.sidebarRight && runtime.sidebarRight.mounted;
    if (!mounted || typeof mounted.getSnapshot !== 'function') {
      setTimeout(() => resolve(false), 120);
      return;
    }
    if (mounted.getSnapshot() === sessionId) {
      resolve(true);
      return;
    }
    let done = false;
    let timer;
    let unsubscribe = () => {};
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    };
    if (typeof mounted.subscribe === 'function') {
      unsubscribe = mounted.subscribe(() => {
        if (mounted.getSnapshot() === sessionId) finish(true);
      });
    }
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

function restoreRightbar(runtime, prior) {
  try {
    const sidebar = runtime.sidebarRight;
    if (prior && prior.expanded) {
      if (!sidebar.isExpanded()) sidebar.toggleExpanded();
      if (prior.activeId) {
        try {
          sidebar.focus(prior.activeId);
        } catch (error) {
          // The previous tab may be gone.
        }
      }
    } else if (sidebar.isExpanded()) {
      sidebar.toggleExpanded();
    }
  } catch (error) {
    console.warn('[gis-workbench] could not restore the conversation panel state', error);
  }
}

async function enterWorkbench(runtime, sessionId) {
  if (workbenchOpen) {
    if (activeMapSessionId) openChat(runtime, activeMapSessionId);
    return true;
  }
  try {
    const sidebar = runtime.sidebarRight;
    const active = sidebar.active();
    priorRightbar = {
      expanded: sidebar.isExpanded(),
      activeId: active ? active.id : null,
    };
  } catch (error) {
    priorRightbar = null;
  }
  activeAnchorSessionId = sessionId;
  activeMapSessionId = sessionId || undefined;
  setWorkbenchOpen(true);
  ++workbenchEpoch;
  if (!sessionId) {
    openChat(runtime);
    return true;
  }
  activateMapChat(runtime, sessionId);
  return true;
}

function exitWorkbench(runtime) {
  workbenchEpoch += 1;
  setWorkbenchOpen(false);
  const anchor = activeAnchorSessionId;
  const map = activeMapSessionId;
  const prior = priorRightbar;
  priorRightbar = null;
  activeAnchorSessionId = undefined;
  activeMapSessionId = undefined;
  closeChat(runtime);
  restoreRightbar(runtime, prior);
}

export function createPlugin(ReactRuntime) {
  React = ReactRuntime;
  h = React.createElement;
  useState = React.useState;
  useEffect = React.useEffect;
  useRef = React.useRef;
  useCallback = React.useCallback;
  useMemo = React.useMemo;

  ChatBoundary = class ChatBoundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { failed: false };
    }

    static getDerivedStateFromError() {
      return { failed: true };
    }

    componentDidCatch(error) {
      console.error('[gis-workbench] embedded conversation failed', error);
    }

    render() {
      if (this.state.failed) {
        return h('div', { className: 'gis-chat-empty' }, this.props.fallback);
      }
      return this.props.children;
    }
  };

  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'gis-workbench: dictionaries');
    const t = ctx.locale.bind(NS);
    chatTabTitle = t('chat.tab');

    try {
      const layout = ctx.get('layout');
      const active = layout && layout.panelInfo && layout.panelInfo.getSnapshot ? layout.panelInfo.getSnapshot() : undefined;
      if (active && active.activePanelId === 'gis-workbench') layout.selectPanel(null);
    } catch (error) {
      console.warn('[gis-workbench] could not clear the legacy workbench panel selection', error);
    }

    const tabTypes = ctx.get('sidebarRightTabs');
    if (tabTypes && typeof tabTypes.register === 'function') {
      ctx.effect(() => {
        try {
          return tabTypes.register({
            id: CHAT_ID,
            kind: CHAT_KIND,
            title: () => t('chat.tab'),
          });
        } catch (error) {
          console.error('[gis-workbench] could not register the conversation tab type', error);
          return undefined;
        }
      }, 'gis-workbench: conversation tab type');
    } else {
      console.warn('[gis-workbench] the sidebar tab registry is unavailable; the map panel still works.');
    }

    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: 'gis-workbench-overlay',
      order: 50,
      locale: NS,
    }, makeOverlay(ctx, t)));

    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: CHAT_ID,
      locale: NS,
    }, makeChatTab(ctx, t)));

    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'gis-composer-bridge',
      order: 30,
      locale: NS,
    }, makeComposerBridge(ctx, t)));

    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'gis-workbench-launcher',
      order: 40,
      locale: NS,
    }, makeLauncher(ctx, t)));

    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: TOOL_VIEW_KEY,
      locale: NS,
    }, makeToolView(ctx, t)));

    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: VIEW_TOOL_NAME,
      locale: NS,
    }, makeViewToolView(ctx, t)));

    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
      name: 'tool.call.toolview',
      key: UPDATE_STYLE_TOOL_NAME,
      locale: NS,
    }, makeStyleToolView(ctx, t)));
  }

  return {
    inject: ['slots', 'locale', 'sidebarRight', 'theme'],
    apply,
  };
}
/** Exported so a headless harness can mount the map without the host shell. */
export { MapCanvas };
