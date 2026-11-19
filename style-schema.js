export const STYLE_SCHEMA_VERSION = 1;
export const DEFAULT_LABEL_FONT = ['Open Sans Regular'];
export const MAP_GLYPHS_URL = '/api/gis-workbench/glyphs/{fontstack}/{range}.pbf';

const STYLE_KEYS = new Set([
  'fillColor', 'fillOpacity',
  'lineColor', 'lineWidth', 'lineOpacity',
  'circleColor', 'circleRadius', 'circleOpacity',
  'lineVisible', 'circleVisible',
  'categorical', 'opacity', 'label',
]);
const LABEL_KEYS = new Set([
  'field', 'valueMap', 'fallback', 'size', 'color', 'haloColor', 'haloWidth',
  'minzoom', 'maxzoom', 'allowOverlap', 'font', 'anchor', 'onePerFeature',
]);

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(name + ' must be an object');
  }
}

function number(value, name, min, max) {
  if (value === undefined) return undefined;
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result)) throw new Error(name + ' must be a number');
  if (result < min || result > max) throw new Error(name + ' must be between ' + min + ' and ' + max);
  return result;
}

function color(value, name) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!text || text.length > 80 || /[\u0000-\u001f;{}]/.test(text)) {
    throw new Error(name + ' is not a valid color');
  }
  return text;
}

function boolean(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(name + ' must be a boolean');
  return value;
}

function normalizeLabel(input) {
  if (input === null || input === false) return null;
  assertObject(input, 'style.label');
  for (const key of Object.keys(input)) {
    if (!LABEL_KEYS.has(key)) throw new Error('Unknown style.label key: ' + key);
  }
  const field = String(input.field || '').trim();
  if (!field) throw new Error('style.label.field is required');
  if (field.length > 80) throw new Error('style.label.field is too long');
  const output = { field };
  if (input.valueMap !== undefined) {
    assertObject(input.valueMap, 'style.label.valueMap');
    const entries = Object.entries(input.valueMap);
    if (entries.length > 500) throw new Error('style.label.valueMap supports at most 500 entries');
    output.valueMap = {};
    for (const [key, value] of entries) {
      output.valueMap[String(key)] = String(value).slice(0, 200);
    }
  }
  if (input.fallback !== undefined) output.fallback = String(input.fallback).slice(0, 200);
  if (input.size !== undefined) output.size = number(input.size, 'style.label.size', 6, 48);
  if (input.color !== undefined) output.color = color(input.color, 'style.label.color');
  if (input.haloColor !== undefined) output.haloColor = color(input.haloColor, 'style.label.haloColor');
  if (input.haloWidth !== undefined) output.haloWidth = number(input.haloWidth, 'style.label.haloWidth', 0, 4);
  if (input.minzoom !== undefined) output.minzoom = number(input.minzoom, 'style.label.minzoom', 0, 24);
  if (input.maxzoom !== undefined) output.maxzoom = number(input.maxzoom, 'style.label.maxzoom', 0, 24);
  if (output.minzoom !== undefined && output.maxzoom !== undefined && output.maxzoom < output.minzoom) {
    throw new Error('style.label.maxzoom must be greater than or equal to minzoom');
  }
  if (input.allowOverlap !== undefined) output.allowOverlap = boolean(input.allowOverlap, 'style.label.allowOverlap');
  if (input.onePerFeature !== undefined) output.onePerFeature = boolean(input.onePerFeature, 'style.label.onePerFeature');
  if (input.font !== undefined) {
    if (!Array.isArray(input.font) || input.font.length === 0) throw new Error('style.label.font must be a non-empty array');
    output.font = input.font.map((item) => String(item).slice(0, 80));
  }
  if (input.anchor !== undefined) {
    const anchor = String(input.anchor);
    if (!['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(anchor)) {
      throw new Error('Invalid style.label.anchor');
    }
    output.anchor = anchor;
  }
  return output;
}

/** Validate and normalize a semantic style patch. Unknown keys are rejected. */
export function normalizeStylePatch(input) {
  assertObject(input, 'stylePatch');
  const output = {};
  for (const key of Object.keys(input)) {
    if (!STYLE_KEYS.has(key)) throw new Error('Unknown style key: ' + key);
  }
  if (input.fillColor !== undefined) output.fillColor = color(input.fillColor, 'style.fillColor');
  if (input.fillOpacity !== undefined) output.fillOpacity = number(input.fillOpacity, 'style.fillOpacity', 0, 1);
  if (input.lineColor !== undefined) output.lineColor = color(input.lineColor, 'style.lineColor');
  if (input.lineWidth !== undefined) output.lineWidth = number(input.lineWidth, 'style.lineWidth', 0, 20);
  if (input.lineOpacity !== undefined) output.lineOpacity = number(input.lineOpacity, 'style.lineOpacity', 0, 1);
  if (input.circleColor !== undefined) output.circleColor = color(input.circleColor, 'style.circleColor');
  if (input.circleRadius !== undefined) output.circleRadius = number(input.circleRadius, 'style.circleRadius', 0, 30);
  if (input.circleOpacity !== undefined) output.circleOpacity = number(input.circleOpacity, 'style.circleOpacity', 0, 1);
  if (input.lineVisible !== undefined) output.lineVisible = boolean(input.lineVisible, 'style.lineVisible');
  if (input.circleVisible !== undefined) output.circleVisible = boolean(input.circleVisible, 'style.circleVisible');
  if (input.categorical !== undefined) {
    const categorical = input.categorical;
    assertObject(categorical, 'style.categorical');
    const field = String(categorical.field || '').trim();
    if (!field) throw new Error('style.categorical.field is required');
    assertObject(categorical.values, 'style.categorical.values');
    const entries = Object.entries(categorical.values);
    if (entries.length > 500) throw new Error('style.categorical.values supports at most 500 entries');
    const values = {};
    for (const [key, item] of entries) {
      assertObject(item, 'style.categorical.values.' + key);
      const entry = { color: color(item.color, 'style.categorical.values.' + key + '.color') };
      if (!entry.color) throw new Error('style.categorical.values.' + key + '.color is required');
      if (item.label !== undefined) entry.label = String(item.label).slice(0, 120);
      values[String(key)] = entry;
    }
    output.categorical = { field, values };
    if (categorical.fallbackColor !== undefined) {
      output.categorical.fallbackColor = color(categorical.fallbackColor, 'style.categorical.fallbackColor');
    }
  }
  if (input.opacity !== undefined) output.opacity = number(input.opacity, 'style.opacity', 0, 1);
  if (input.label !== undefined) output.label = normalizeLabel(input.label);
  return output;
}

/** Merge a normalized patch into an existing layer style. */
export function mergeLayerStyle(baseStyle, patch) {
  const base = baseStyle && typeof baseStyle === 'object' ? baseStyle : {};
  const normalized = normalizeStylePatch(patch || {});
  const merged = Object.assign({}, base);
  for (const [key, value] of Object.entries(normalized)) {
    if (key === 'label') {
      if (value === null) delete merged.label;
      else if (!base.label || typeof base.label !== 'object' || base.label.field !== value.field) merged.label = value;
      else merged.label = Object.assign({}, base.label, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export const STYLE_SCHEMA = {
  version: STYLE_SCHEMA_VERSION,
  description: 'Semantic vector layer style patch. Style is persisted in the project layer record; the browser applies it to MapLibre.',
  properties: {
    fillColor: 'CSS color for polygon fill',
    fillOpacity: '0..1 polygon fill opacity',
    lineColor: 'CSS color for line and polygon outline',
    lineWidth: '0..20 line width in pixels',
    lineOpacity: '0..1 line opacity',
    circleColor: 'CSS color for point circles',
    circleRadius: '0..30 circle radius in pixels',
    circleOpacity: '0..1 circle opacity',
    lineVisible: 'set false to hide the line/outline layer',
    circleVisible: 'set false to hide the point-circle layer',
    categorical: {
      field: 'Attribute field for per-value fill colors',
      values: 'Map of field value to {color, label}',
      fallbackColor: 'Fill color used for values not present in the map',
    },
    opacity: '0..1 overall opacity hint for the layer',
    label: {
      field: 'Attribute field used as label text',
      valueMap: 'Optional exact-value map, e.g. {"R":"住宅","C":"商业"}; unknown values use fallback/original',
      fallback: 'Text used for values missing from valueMap; defaults to the original value',
      size: '6..48 text size in pixels',
      color: 'text color',
      haloColor: 'halo color',
      haloWidth: '0..4 halo width',
      minzoom: '0..24 minimum zoom',
      maxzoom: '0..24 maximum zoom',
      allowOverlap: 'true to allow colliding labels',
      onePerFeature: 'true to place exactly one centered label per feature (uses the largest polygon centroid)',
      anchor: 'center|top|bottom|left|right|corner variants',
    },
  },
  example: {
    label: {
      field: 'CODE',
      valueMap: { Building: '建筑', Deck: '露台', Patio: '庭院' },
      size: 12,
      color: '#16423a',
      haloColor: '#ffffff',
      haloWidth: 1.2,
      minzoom: 15,
    },
  },
  fonts: DEFAULT_LABEL_FONT,
  glyphsUrl: MAP_GLYPHS_URL,
};
