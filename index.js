import {
  DEFAULT_ATTRIBUTION,
  DEFAULT_LAYER_NAME,
  DEFAULT_TILE_SIZE,
  DEFAULT_TILE_URL,
  DEFAULT_VIEW_ZOOM,
  PLACE_PRESETS,
  TOOL_NAME,
  VIEW_TOOL_NAME,
  LIST_LAYERS_TOOL_NAME,
  DESCRIBE_LAYER_TOOL_NAME,
  SAMPLE_FIELD_TOOL_NAME,
  MAP_CAPABILITIES_TOOL_NAME,
  UPDATE_STYLE_TOOL_NAME,
} from './shared.js';
import { GisStore } from './server/store.js';
import { createApiHandler } from './server/api.js';

export const name = '@focus-daima/gis-workbench';
export const inject = ['tools'];

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: {
      type: 'string',
      description: 'Layer name shown in the workbench. Defaults to 天地图影像.',
    },
    tileUrl: {
      type: 'string',
      description:
        'Raster XYZ tile URL template containing {z}, {x}, and {y}. Defaults to the Tianditu image layer at '
        + DEFAULT_TILE_URL
        + '.',
    },
    tileSize: {
      type: 'integer',
      enum: [256, 512],
      description: 'Raster tile size in pixels. Defaults to 256.',
    },
    minzoom: {
      type: 'number',
      description: 'Minimum zoom at which the layer is shown. Defaults to 0.',
    },
    maxzoom: {
      type: 'number',
      description: 'Maximum zoom at which tiles are requested. Defaults to 18.',
    },
    attribution: {
      type: 'string',
      description: 'Attribution text for the layer. Defaults to 天地图.',
    },
  },
};

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['layerId', 'name', 'tileUrl', 'tileSize', 'minzoom', 'maxzoom', 'attribution', 'message'],
  properties: {
    layerId: { type: 'string' },
    name: { type: 'string' },
    tileUrl: { type: 'string' },
    tileSize: { type: 'integer' },
    minzoom: { type: 'number' },
    maxzoom: { type: 'number' },
    attribution: { type: 'string' },
    message: { type: 'string' },
  },
};

function numberInRange(value, fallback, min, max) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalize(args) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const name = String(input.name || DEFAULT_LAYER_NAME).trim() || DEFAULT_LAYER_NAME;
  const tileUrl = String(input.tileUrl || DEFAULT_TILE_URL).trim() || DEFAULT_TILE_URL;
  if (!tileUrl.includes('{z}') || !tileUrl.includes('{x}') || !tileUrl.includes('{y}')) {
    throw new Error('tileUrl must be an XYZ raster template containing {z}, {x}, and {y}');
  }
  const tileSize = Number(input.tileSize) === 512 ? 512 : DEFAULT_TILE_SIZE;
  const minzoom = numberInRange(input.minzoom, 0, 0, 24);
  const maxzoom = numberInRange(input.maxzoom, 18, minzoom, 24);
  const attribution = String(input.attribution || DEFAULT_ATTRIBUTION).trim() || DEFAULT_ATTRIBUTION;
  return {
    layerId: 'tianditu-image',
    name: name.slice(0, 120),
    tileUrl,
    tileSize,
    minzoom,
    maxzoom,
    attribution,
    message: `Added raster layer "${name.slice(0, 120)}" to the GIS workbench map.`,
  };
}

const VIEW_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    center: {
      type: 'array',
      items: { type: 'number' },
      description: 'Target center as [longitude, latitude] in WGS84 degrees, e.g. [120.1551, 30.2741] for Hangzhou.',
    },
    place: {
      type: 'string',
      description: 'Optional place key resolved by the workbench gazetteer, e.g. hangzhou, beijing, shanghai, china.',
    },
    zoom: {
      type: 'number',
      description: 'Target zoom level, 0-24. A city view is around 10-12, a country view around 3-4.',
    },
    label: {
      type: 'string',
      description: 'Short human label for the target, shown on the map tool card.',
    },
  },
};

const VIEW_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['center', 'zoom', 'label', 'message'],
  properties: {
    center: { type: 'array', items: { type: 'number' } },
    zoom: { type: 'number' },
    label: { type: 'string' },
    message: { type: 'string' },
  },
};

function normalizeView(args) {
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const placeKey = String(input.place || '').trim().toLowerCase();
  const preset = placeKey ? PLACE_PRESETS[placeKey] : undefined;
  let center = null;
  if (Array.isArray(input.center) && input.center.length >= 2) {
    center = [Number(input.center[0]), Number(input.center[1])];
  } else if (preset) {
    center = preset.center.slice();
  }
  if (!center || !center.every((value) => Number.isFinite(value))) {
    throw new Error('A map view request needs either center [lng, lat] or a known place name');
  }
  const lng = Math.min(180, Math.max(-180, center[0]));
  const lat = Math.min(85, Math.max(-85, center[1]));
  const zoom = numberInRange(input.zoom !== undefined ? input.zoom : preset && preset.zoom, DEFAULT_VIEW_ZOOM, 0, 24);
  const label = String(input.label || (preset && preset.label) || (lat.toFixed(4) + '°N, ' + lng.toFixed(4) + '°E')).slice(0, 120);
  return {
    center: [lng, lat],
    zoom,
    label,
    message: `Moved the GIS workbench map to "${label}" (${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E, zoom ${zoom}).`,
  };
}

function toolResultText(values) {
  return [{ type: 'text', text: values.join('\n') }];
}

function registerMapDataTools(scope, tools, store, ready) {
  const register = (definition, label) => {
    scope.effect(() => tools.register(definition), label);
  };

  register({
    name: LIST_LAYERS_TOOL_NAME,
    description:
      'List vector/raster layers in GIS projects. Use this first when the user refers to a layer by name such as "building". '
      + 'Returns layerId, projectId, projectName, dataset format/kind, feature count, attribute fields, bbox, visibility, z, and current style. '
      + 'A layerId is required by gis_describe_layer, gis_sample_field, and gis_update_layer_style.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string', description: 'Optional project id to restrict the search.' },
        query: { type: 'string', description: 'Optional case-insensitive name/field/project filter, e.g. building.' },
        limit: { type: 'integer', description: 'Maximum results, 1-200. Defaults to 100.' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, required: ['layers', 'message'], properties: { layers: { type: 'array' }, message: { type: 'string' } } },
      render(_args, value) { return toolResultText([value.message]); },
    },
    async execute(args) {
      await ready;
      let layers = store.listAllLayers(args);
      if (args && args.projectId) layers = layers.filter((layer) => layer.projectId === args.projectId);
      return {
        layers,
        message: layers.length === 0
          ? 'No matching layers were found.'
          : 'Found ' + layers.length + ' layer(s): ' + layers.map((layer) => layer.name + ' [' + layer.layerId + ']').join(', '),
      };
    },
    presentCall(args) { return { card: 'generic', title: 'List map layers', kind: 'other', rawInput: args }; },
    isConcurrencySafe() { return true; },
  }, 'gis-workbench: list layers tool');

  register({
    name: DESCRIBE_LAYER_TOOL_NAME,
    description:
      'Describe one map layer before styling it. Returns project, geometry/data format, feature count, bbox, attribute fields, current semantic style, and renderability. '
      + 'Use this to verify that a field such as CODE exists before adding a label.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['layerId'],
      properties: { layerId: { type: 'string', description: 'Layer id returned by gis_list_layers.' } },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, required: ['layer', 'fields', 'message'], properties: { layer: { type: 'object' }, fields: { type: 'array' }, message: { type: 'string' } } },
      render(_args, value) { return toolResultText([value.message]); },
    },
    async execute(args) {
      await ready;
      const info = store.describeLayer(args.layerId);
      return Object.assign({}, info, {
        message: 'Layer "' + info.layer.name + '": ' + info.kind + '/' + info.format
          + ', ' + (info.featureCount || 0) + ' features, fields: ' + (info.fields.length ? info.fields.join(', ') : 'none')
          + ', renderable: ' + info.renderable,
      });
    },
    presentCall(args) { return { card: 'generic', title: 'Describe map layer', kind: 'other', rawInput: args }; },
    isConcurrencySafe() { return true; },
  }, 'gis-workbench: describe layer tool');

  register({
    name: SAMPLE_FIELD_TOOL_NAME,
    description:
      'Return distinct values from one attribute field so they can be translated or mapped. Use before creating a Chinese label valueMap. '
      + 'The field must exist on the layer. Limit is capped at 500.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['layerId', 'field'],
      properties: {
        layerId: { type: 'string' },
        field: { type: 'string', description: 'Attribute field name, e.g. CODE.' },
        limit: { type: 'integer', description: 'Maximum distinct values, 1-500. Defaults to 50.' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, required: ['values', 'message'], properties: { values: { type: 'array' }, message: { type: 'string' } } },
      render(_args, value) { return toolResultText([value.message]); },
    },
    async execute(args) {
      await ready;
      const result = await store.sampleLayerField(args.layerId, args.field, args.limit);
      return Object.assign({}, result, {
        message: 'Field "' + result.field + '" distinct values' + (result.truncated ? ' (truncated)' : '') + ': '
          + JSON.stringify(result.values),
      });
    },
    presentCall(args) { return { card: 'generic', title: 'Sample field values', kind: 'other', rawInput: args }; },
    isConcurrencySafe() { return true; },
  }, 'gis-workbench: sample field tool');

  register({
    name: MAP_CAPABILITIES_TOOL_NAME,
    description:
      'Return the current map style capability schema: supported semantic style keys, label options, fonts, glyph URL, and examples. '
      + 'Call this when unsure which style properties are supported or before a complex label/style request.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: { type: 'object', additionalProperties: true, required: ['styleSchema', 'message'], properties: { styleSchema: { type: 'object' }, message: { type: 'string' } } },
      render(_args, value) { return toolResultText([value.message]); },
    },
    async execute() {
      await ready;
      const capabilities = store.mapCapabilities();
      return Object.assign({}, capabilities, {
        message: 'Map styling supports: ' + Object.keys(capabilities.styleSchema.properties).join(', ') + '. Labels are supported with valueMap translation.',
      });
    },
    presentCall() { return { card: 'generic', title: 'Map capabilities', kind: 'other' }; },
    isConcurrencySafe() { return true; },
  }, 'gis-workbench: map capabilities tool');

  register({
    name: UPDATE_STYLE_TOOL_NAME,
    description:
      'Update the persisted semantic style of one vector layer. Use gis_list_layers + gis_describe_layer + gis_sample_field first. '
      + 'Supported patch keys: fillColor, fillOpacity, lineColor, lineWidth, lineOpacity, circleColor, circleRadius, circleOpacity, lineVisible, circleVisible, categorical, opacity, and label. '
      + 'The label object supports field, valueMap, fallback, size, color, haloColor, haloWidth, minzoom, maxzoom, allowOverlap, font, anchor, and onePerFeature (one centered label per feature). '
      + 'Example for building labels: {"label":{"field":"CODE","valueMap":{"Building":"建筑","Deck":"露台","Patio":"庭院"},"size":12,"minzoom":15}}. '
      + 'To remove a label, set label to null. Unknown keys are rejected. This persists to the layer style and the browser map applies it immediately.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['layerId', 'stylePatch'],
      properties: {
        layerId: { type: 'string', description: 'Layer id from gis_list_layers.' },
        stylePatch: {
          type: 'object',
          additionalProperties: true,
          description: 'Semantic style patch. Keys are documented in the tool description; unknown keys fail validation.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['layerId', 'style', 'message'],
        properties: { layerId: { type: 'string' }, style: { type: 'object' }, layer: { type: 'object' }, message: { type: 'string' } },
      },
      render(_args, value) { return toolResultText([value.message]); },
    },
    async execute(args) {
      await ready;
      const result = store.updateLayerStyle(args.layerId, args.stylePatch);
      return Object.assign({}, result, {
        layerId: args.layerId,
        message: 'Updated style for layer "' + result.layer.name + '": ' + JSON.stringify(result.style),
      });
    },
    presentCall(args) { return { card: 'generic', title: 'Update layer style', kind: 'other', rawInput: args }; },
    isConcurrencySafe() { return false; },
  }, 'gis-workbench: update layer style tool');
}

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: TOOL_NAME,
    description:
      'Add a raster tile layer to the GIS workbench map. Use this when the user asks to add, show, or load a map layer, '
      + 'especially the Tianditu image layer. Call with no arguments to add the default Tianditu imagery layer from '
      + DEFAULT_TILE_URL
      + '. The layer is applied to the workbench map after this tool result settles, and is retained for when the user opens the workbench.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: value.message }];
      },
    },
    async execute(args) {
      return normalize(args);
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: 'Add map layer',
        kind: 'other',
        rawInput: args,
      };
    },
    isConcurrencySafe() {
      return true;
    },
  }), 'gis-workbench: add layer tool');

  ctx.effect(() => ctx.tools.register({
    name: VIEW_TOOL_NAME,
    description:
      'Move the GIS workbench map camera to a place or explicit coordinates. Use this when the user asks to zoom, pan, '
      + 'or fit the map to a city, region, or country — for example 地图缩放到中国杭州范围. The camera moves as soon as '
      + 'the tool result settles, and the view is kept for when the user opens the workbench.',
    parameters: VIEW_PARAMETERS,
    output: {
      schema: VIEW_OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: value.message }];
      },
    },
    async execute(args) {
      return normalizeView(args);
    },
    presentCall() {
      return {
        card: 'generic',
        title: 'Move map view',
        kind: 'other',
      };
    },
    isConcurrencySafe() {
      return true;
    },
  }), 'gis-workbench: set view tool');

  ctx.inject(['webServer'], (scope) => {
    const workspace = process.cwd();
    const store = new GisStore(workspace);
    const ready = store.init().catch((error) => {
      console.error('[gis-workbench] database initialization failed', error);
      throw error;
    });
    registerMapDataTools(scope, ctx.tools, store, ready);
    const handler = createApiHandler(store);
    const guarded = async (req, res) => {
      try {
        await ready;
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'GIS database is unavailable' }));
        return;
      }
      return handler(req, res);
    };
    const disposeRoute = scope.webServer.register({
      kind: 'prefix',
      path: '/api/gis-workbench',
      handler: guarded,
    });
    scope.effect(() => () => {
      disposeRoute();
      store.close();
    }, 'gis-workbench: SQLite store and HTTP API');
    console.log('[gis-workbench] SQLite store ready at', store.dbPath);
  });
}