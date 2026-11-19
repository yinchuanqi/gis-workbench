import {
  DEFAULT_ATTRIBUTION,
  DEFAULT_LAYER_NAME,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILE_URL,
} from '../shared.js';
import { mergeLayerStyle } from '../style-schema.js';

/** The in-memory layer collection is the single source the map and layer panel read. */
let layers = [];
let sequence = 0;
let view = null;
let viewSequence = 0;
const listeners = new Set();

function notify() {
  for (const listener of [...listeners]) listener();
}

function asNumber(value, fallback, min, max) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function stableId(key) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 'gis-' + (hash >>> 0).toString(36);
}

/**
 * Resolve a protocol-relative tile template against the page protocol. The
 * GIS tile service is served outside the GUI origin, so the browser must know
 * the concrete scheme before the map engine requests a tile.
 */
export function resolveTileUrl(template) {
  const trimmed = String(template || '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) {
    const protocol = typeof window !== 'undefined' && window.location ? window.location.protocol : 'http:';
    return protocol + trimmed;
  }
  if (trimmed.startsWith('/') && typeof window !== 'undefined' && window.location && window.location.origin) {
    return window.location.origin + trimmed;
  }
  return trimmed;
}

export function getLayers() {
  return layers;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function addLayer(input) {
  const name = String(input && input.name ? input.name : DEFAULT_LAYER_NAME).trim() || DEFAULT_LAYER_NAME;
  const tileUrl = String(input && input.tileUrl ? input.tileUrl : DEFAULT_TILE_URL).trim() || DEFAULT_TILE_URL;
  const key = String(input && input.key ? input.key : 'layer-' + (sequence += 1));
  const next = {
    key,
    name,
    renderKind: 'raster-tiles',
    tileUrl,
    tileSize: Number(input && input.tileSize) === 512 ? 512 : DEFAULT_TILE_SIZE,
    minzoom: asNumber(input && input.minzoom, 0, 0, 24),
    maxzoom: asNumber(input && input.maxzoom, 18, 0, 24),
    attribution: String(input && input.attribution ? input.attribution : DEFAULT_ATTRIBUTION),
    visible: !(input && input.visible === false),
    source: String(input && input.source ? input.source : 'conversation'),
    z: asNumber(input && input.z, 1000, -1000, 10000),
  };

  const existing = layers.find((layer) => layer.tileUrl === next.tileUrl);
  if (existing) {
    const updated = Object.assign({}, existing, {
      name: next.name,
      tileSize: next.tileSize,
      minzoom: next.minzoom,
      maxzoom: next.maxzoom,
      attribution: next.attribution,
    });
    layers = layers.map((layer) => (layer.key === existing.key ? updated : layer));
    notify();
    return updated;
  }

  const layer = Object.assign({}, next, { id: stableId(key) });
  layers = [...layers, layer].sort((left, right) => (left.z || 0) - (right.z || 0));
  notify();
  return layer;
}

/** Replace the persisted layers of one project while keeping session-only layers. */
export function replaceProjectLayers(projectId, incoming) {
  const kept = layers.filter((layer) => layer.source !== 'project');
  const projectLayers = (Array.isArray(incoming) ? incoming : []).map((layer) => Object.assign({}, layer, {
    id: layer.id || stableId(layer.key),
    source: 'project',
    persisted: true,
    projectId,
  }));
  layers = [...kept, ...projectLayers].sort((left, right) => (left.z || 0) - (right.z || 0));
  notify();
}

export function updateProjectLayerStyle(layerId, stylePatch) {
  let changed = false;
  layers = layers.map((layer) => {
    if (layer.layerId !== layerId && layer.id !== layerId) return layer;
    changed = true;
    return Object.assign({}, layer, { style: mergeLayerStyle(layer.style, stylePatch) });
  });
  if (changed) notify();
  return changed;
}

export function reorderLayers(sourceKey, targetKey, after) {
  if (!sourceKey || !targetKey || sourceKey === targetKey) return false;
  const sourceIndex = layers.findIndex((layer) => layer.key === sourceKey);
  if (sourceIndex < 0) return false;
  const next = layers.slice();
  const [moved] = next.splice(sourceIndex, 1);
  let targetIndex = next.findIndex((layer) => layer.key === targetKey);
  if (targetIndex < 0) return false;
  if (after) targetIndex += 1;
  next.splice(targetIndex, 0, moved);
  layers = next.map((layer, index) => layer.z === index ? layer : Object.assign({}, layer, { z: index }));
  notify();
  return true;
}

export function removeLayer(key) {
  const next = layers.filter((layer) => layer.key !== key);
  if (next.length === layers.length) return;
  layers = next;
  notify();
}

export function toggleLayerVisibility(key) {
  let changed = false;
  layers = layers.map((layer) => {
    if (layer.key !== key) return layer;
    changed = true;
    return Object.assign({}, layer, { visible: !layer.visible });
  });
  if (changed) notify();
}

export function clearLayers() {
  if (layers.length === 0) return;
  layers = [];
  notify();
}

/**
 * Latest camera request. Every call produces a new token so the map reacts even
 * when the same coordinates are requested twice in a row.
 */
export function getView() {
  return view;
}

export function setView(input) {
  const center = input && Array.isArray(input.center) ? input.center : null;
  if (!center || center.length < 2) return null;
  const lng = Number(center[0]);
  const lat = Number(center[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const zoom = asNumber(input && input.zoom, 11, 0, 24);
  viewSequence += 1;
  view = {
    token: viewSequence,
    center: [Math.min(180, Math.max(-180, lng)), Math.min(85, Math.max(-85, lat))],
    zoom,
    label: String(input && input.label ? input.label : '').trim(),
    key: String(input && input.key ? input.key : 'view-' + viewSequence),
  };
  notify();
  return view;
}