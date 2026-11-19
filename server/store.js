import { DatabaseSync } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { STYLE_SCHEMA, mergeLayerStyle, normalizeStylePatch } from '../style-schema.js';

const API_PREFIX = '/api/gis-workbench';
const MAX_FILE_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const INSPECT_FILE_LIMIT = 64 * 1024 * 1024;
const COG_MAX_ZOOM = 22;
const execFileAsync = promisify(execFile);
const UNZIP_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'unzip.py');
const VECTOR_INFO_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vector_info.py');
const DROP_LAYER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'drop_layer.py');
const VECTOR_EDIT_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vector_edit.py');
const PG_TABLES_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pg_tables.py');
const ALLOWED_FILE_EXTENSIONS = new Set([
  '.geojson', '.json', '.csv', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp', '.shp', '.gpkg', '.zip',
]);

function jsonParse(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function jsonString(value, fallback) {
  try {
    return JSON.stringify(value === undefined ? fallback : value);
  } catch (error) {
    return JSON.stringify(fallback);
  }
}

function isInside(root, target) {
  return target === root || target.startsWith(root + path.sep);
}

function parseBbox(value) {
  if (value === null || value === undefined || value === '') return null;
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch (error) {
      candidate = candidate.split(',').map((part) => Number(part.trim()));
    }
  }
  if (!Array.isArray(candidate) || candidate.length !== 4) return null;
  const numbers = candidate.map((part) => Number(part));
  if (numbers.some((number) => !Number.isFinite(number))) return null;
  const [west, south, east, north] = numbers;
  if (west > east || south > north) return null;
  return [west, south, east, north];
}

function parseCrs(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function fieldType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function mergeFieldType(current, next) {
  if (current === undefined || current === 'null') return next;
  if (next === 'null' || current === next) return current;
  return 'mixed';
}

function isTileTemplate(uri) {
  return typeof uri === 'string'
    && /^(https?:)?\/\//i.test(uri)
    && uri.includes('{z}')
    && uri.includes('{x}')
    && uri.includes('{y}');
}

function safeUploadName(name) {
  const base = path.basename(String(name || 'upload.bin'));
  const sanitized = base.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '');
  return (sanitized || 'upload.bin').slice(-140);
}

function serializeUpload(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    size: row.size,
    chunkSize: row.chunk_size,
    totalChunks: row.total_chunks,
    receivedChunks: jsonParse(row.received, []),
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function kindHint(name) {
  const ext = path.extname(name).toLowerCase();
  if (['.geojson', '.json', '.shp', '.gpkg', '.zip'].includes(ext)) return 'vector';
  if (['.tif', '.tiff', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return 'raster';
  if (ext === '.csv') return 'table';
  return 'unknown';
}

function mimeForFormat(format, fileName) {
  if (format === 'geojson') return 'application/geo+json; charset=utf-8';
  if (format === 'cog') return 'image/tiff';
  if (format === 'csv') return 'text/csv; charset=utf-8';
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'application/octet-stream';
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function collectGeoJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw httpError(400, 'The file is not valid JSON');
  }
  const features = value && value.type === 'FeatureCollection' && Array.isArray(value.features)
    ? value.features
    : value && value.type === 'Feature'
      ? [value]
      : value && value.type
        ? [{ type: 'Feature', properties: {}, geometry: value }]
        : [];
  const geometryTypes = new Set();
  const fields = new Map();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sawCoordinate = false;

  const visitCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      const x = coordinates[0];
      const y = coordinates[1];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        sawCoordinate = true;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      return;
    }
    for (const part of coordinates) visitCoordinates(part);
  };

  for (const feature of features) {
    const geometry = feature && feature.geometry;
    if (geometry && typeof geometry.type === 'string') {
      geometryTypes.add(geometry.type);
      visitCoordinates(geometry.coordinates);
    }
    const properties = feature && feature.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const [key, value] of Object.entries(properties)) {
        fields.set(key, mergeFieldType(fields.get(key), fieldType(value)));
      }
    }
  }

  return {
    kind: 'vector',
    crs: 4326,
    bbox: sawCoordinate ? [minX, minY, maxX, maxY] : null,
    profile: {
      format: 'geojson',
      renderable: true,
      featureCount: features.length,
      geometryTypes: [...geometryTypes],
      fields: Object.fromEntries(fields),
    },
  };
}

async function inspectCsv(filePath, sizeBytes) {
  const handle = await fs.open(filePath, 'r');
  let text = '';
  try {
    const buffer = Buffer.alloc(Math.min(sizeBytes, 128 * 1024));
    const result = await handle.read(buffer, 0, buffer.length, 0);
    text = buffer.subarray(0, result.bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0] ? lines[0].split(',').map((part) => part.trim().replace(/^"|"$/g, '')) : [];
  const fields = Object.fromEntries(header.filter(Boolean).map((name) => [name, 'string']));
  return {
    kind: 'table',
    crs: null,
    bbox: null,
    profile: {
      format: 'csv',
      renderable: false,
      rowCountSample: Math.max(0, lines.length - 1),
      fields,
    },
  };
}

async function inspectFile(filePath, sizeBytes, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  if (!ALLOWED_FILE_EXTENSIONS.has(ext) && ext !== '') {
    throw httpError(415, `Unsupported dataset file type: ${ext}`);
  }
  if (ext === '.geojson' || ext === '.json') {
    if (sizeBytes > INSPECT_FILE_LIMIT) {
      return {
        kind: 'vector',
        crs: 4326,
        bbox: null,
        profile: {
          format: 'geojson',
          renderable: false,
          fileName: options.fileName || fileName,
          sizeBytes,
          note: 'GeoJSON is too large to inspect in full; register it now and convert or tile it for rendering.',
        },
      };
    }
    const text = await fs.readFile(filePath, 'utf8');
    const inspected = collectGeoJson(text);
    inspected.profile.sizeBytes = sizeBytes;
    inspected.profile.fileName = options.fileName || fileName;
    return inspected;
  }
  if (ext === '.csv') {
    const inspected = await inspectCsv(filePath, sizeBytes);
    inspected.profile.sizeBytes = sizeBytes;
    inspected.profile.fileName = options.fileName || fileName;
    return inspected;
  }
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const bbox = parseBbox(options.bbox);
    return {
      kind: 'raster',
      crs: parseCrs(options.crs) ?? (bbox ? 4326 : null),
      bbox,
      profile: {
        format: 'image',
        renderable: Boolean(bbox),
        fileName: options.fileName || fileName,
        sizeBytes,
      },
    };
  }
  if (ext === '.tif' || ext === '.tiff') {
    const bbox = parseBbox(options.bbox);
    return {
      kind: 'raster',
      crs: parseCrs(options.crs) ?? (bbox ? 4326 : null),
      bbox,
      profile: {
        format: 'geotiff',
        renderable: false,
        fileName: options.fileName || fileName,
        sizeBytes,
        note: 'GeoTIFF is registered but needs tiling before MapLibre can render it.',
      },
    };
  }
  if (ext === '.shp' || ext === '.zip') {
    return {
      kind: 'vector',
      crs: parseCrs(options.crs),
      bbox: null,
      profile: {
        format: ext === '.zip' ? 'shapefile-zip' : 'shapefile',
        renderable: false,
        fileName: options.fileName || fileName,
        sizeBytes,
        note: 'Shapefile is registered but needs conversion to GeoJSON before rendering.',
      },
    };
  }
  return {
    kind: 'table',
    crs: null,
    bbox: null,
    profile: {
      format: ext.replace(/^\./, '') || 'unknown',
      renderable: false,
      fileName: options.fileName || fileName,
      sizeBytes,
    },
  };
}

async function walkFiles(dir) {
  const result = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(full));
    else if (entry.isFile()) result.push(full);
  }
  return result;
}

function geoJsonBounds(data) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length >= 2 && coordinates.every((value) => typeof value === 'number')) {
      west = Math.min(west, coordinates[0]);
      east = Math.max(east, coordinates[0]);
      south = Math.min(south, coordinates[1]);
      north = Math.max(north, coordinates[1]);
      return;
    }
    for (const child of coordinates) visit(child);
  };
  const features = data && Array.isArray(data.features) ? data.features : [];
  for (const feature of features) {
    if (feature && feature.geometry) visit(feature.geometry.coordinates);
  }
  return {
    count: features.length,
    bbox: Number.isFinite(west) && Number.isFinite(south) && Number.isFinite(east) && Number.isFinite(north)
      ? [west, south, east, north]
      : null,
  };
}

async function isGeoJsonFile(filePath) {
  try {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const head = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '').trimStart();
      return /^\{/.test(head) && /"type"\s*:\s*"(FeatureCollection|Feature|GeometryCollection)"/.test(head);
    } finally {
      await handle.close();
    }
  } catch (error) {
    return false;
  }
}

function bboxFromGdalInfo(info) {
  const ring = info && info.wgs84Extent && info.wgs84Extent.coordinates && info.wgs84Extent.coordinates[0];
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  if (!Number.isFinite(west) || !Number.isFinite(south) || !Number.isFinite(east) || !Number.isFinite(north)) return null;
  return [west, south, east, north];
}

function epsgFromGdalInfo(info) {
  const wkt = info && info.coordinateSystem && info.coordinateSystem.wkt ? info.coordinateSystem.wkt : '';
  const matches = [...wkt.matchAll(/AUTHORITY\[\"EPSG\",\"(\d+)\"\]/g)];
  if (matches.length > 0) {
    const value = Number(matches[matches.length - 1][1]);
    return Number.isInteger(value) ? value : null;
  }
  return null;
}

function chooseMaxZoom(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return COG_MAX_ZOOM;
  const [west, south, east, north] = bbox;
  const area = Math.max(0, (east - west) / 360) * Math.max(0, (north - south) / 180);
  if (!(area > 0)) return COG_MAX_ZOOM;
  let chosen = 0;
  for (let zoom = 0; zoom <= COG_MAX_ZOOM; zoom += 1) {
    if (Math.pow(4, zoom) * area <= 6000) chosen = zoom;
  }
  return chosen;
}

function gdalError(error) {
  const text = error && (error.stderr || error.message) ? String(error.stderr || error.message) : 'GDAL command failed';
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function serializeProject(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    meta: jsonParse(row.meta, {}),
  };
}

function serializeDataset(row) {
  const profile = jsonParse(row.profile, {});
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    uri: row.uri,
    crs: row.crs,
    bbox: jsonParse(row.bbox, null),
    profile,
    createdAt: row.created_at,
    contentUrl: profile.format === 'xyz' || !row.uri ? null : `${API_PREFIX}/datasets/${encodeURIComponent(row.id)}/content`,
    tilesUrl: profile.format === 'cog'
      ? `${API_PREFIX}/datasets/${encodeURIComponent(row.id)}/tiles/{z}/{x}/{y}.png`
      : null,
  };
}

function serializeLayer(row) {
  const dataset = row.dataset_id ? {
    id: row.dataset_id,
    kind: row.dataset_kind,
    uri: row.dataset_uri,
    crs: row.dataset_crs,
    bbox: jsonParse(row.dataset_bbox, null),
    profile: jsonParse(row.dataset_profile, {}),
    format: row.dataset_format,
    contentUrl: row.dataset_uri && row.dataset_format !== 'xyz'
      ? `${API_PREFIX}/datasets/${encodeURIComponent(row.dataset_id)}/content`
      : null,
    tilesUrl: row.dataset_format === 'cog'
      ? `${API_PREFIX}/datasets/${encodeURIComponent(row.dataset_id)}/tiles/{z}/{x}/{y}.png`
      : null,
  } : null;
  return {
    id: row.id,
    projectId: row.project_id,
    datasetId: row.dataset_id,
    name: row.name,
    style: jsonParse(row.style, {}),
    visible: Boolean(row.visible),
    z: row.z,
    dataset,
  };
}

export class GisStore {
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.dataDir = path.join(this.workspaceRoot, '.gis-workbench');
    this.uploadsDir = path.join(this.dataDir, 'uploads');
    this.dbPath = path.join(this.dataDir, 'gis.sqlite');
    const defaultRoots = ['/home/agent', '/data', '/mnt/data', '/srv/data'];
    const configuredRoots = (options.extraRoots ?? (process.env.GIS_WORKBENCH_ROOTS ?? '').split(path.delimiter))
      .map((root) => root.trim())
      .filter(Boolean);
    this.extraRoots = [...new Set([...defaultRoots, ...configuredRoots])];
    this.roots = [];
    this.db = null;
  }

  async init() {
    await fs.mkdir(this.uploadsDir, { recursive: true });
    this.workspaceRoot = await fs.realpath(this.workspaceRoot);
    this.dataDir = await fs.realpath(this.dataDir);
    this.uploadsDir = await fs.realpath(this.uploadsDir);
    this.roots = [this.workspaceRoot];
    if (!this.roots.includes(this.dataDir)) this.roots.push(this.dataDir);
    for (const root of this.extraRoots) {
      try {
        const real = await fs.realpath(root);
        if (!this.roots.includes(real)) this.roots.push(real);
      } catch (error) {
        // Configured roots that do not exist are ignored.
      }
    }
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        meta TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        uri TEXT NOT NULL,
        crs INTEGER,
        bbox TEXT,
        profile TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS layers (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        dataset_id TEXT REFERENCES datasets(id) ON DELETE CASCADE,
        name TEXT,
        style TEXT NOT NULL DEFAULT '{}',
        visible INTEGER NOT NULL DEFAULT 1,
        z INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS datasets_project_idx ON datasets(project_id);
      CREATE INDEX IF NOT EXISTS layers_project_idx ON layers(project_id);
      CREATE INDEX IF NOT EXISTS layers_dataset_idx ON layers(dataset_id);
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        fingerprint TEXT,
        file_name TEXT NOT NULL,
        size INTEGER NOT NULL,
        chunk_size INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        received TEXT NOT NULL DEFAULT '[]',
        temp_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'uploading',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS uploads_project_idx ON uploads(project_id);
      CREATE INDEX IF NOT EXISTS uploads_fingerprint_idx ON uploads(project_id, fingerprint, status);
      CREATE TABLE IF NOT EXISTS databases (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 5432,
        dbname TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        sslmode TEXT NOT NULL DEFAULT 'prefer',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS databases_project_idx ON databases(project_id);
    `);
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM projects').get().count;
    if (count === 0) {
      this.createProject({
        name: '默认工程',
        meta: { units: 'metric', basemap: null, range: null },
      });
    }
    return this;
  }

  close() {
    try {
      if (this.db) this.db.close();
    } catch (error) {
      // Closing a disposed database is harmless.
    }
    this.db = null;
  }

  assertProject(projectId) {
    const project = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) throw httpError(404, 'Project not found');
    return project;
  }

  listProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY created_at, rowid').all().map(serializeProject);
  }

  createProject(input = {}) {
    const name = String(input.name || '').trim() || '未命名工程';
    const meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
    const id = randomUUID();
    this.db.prepare('INSERT INTO projects (id, name, meta) VALUES (?, ?, ?)').run(id, name, jsonString(meta, {}));
    return serializeProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  }

  updateProject(id, input = {}) {
    const current = this.assertProject(id);
    const name = input.name === undefined ? current.name : String(input.name).trim() || current.name;
    const meta = input.meta === undefined ? jsonParse(current.meta, {}) : input.meta;
    this.db.prepare('UPDATE projects SET name = ?, meta = ? WHERE id = ?').run(name, jsonString(meta, {}), id);
    return serializeProject(this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
  }

  listDatasets(projectId) {
    this.assertProject(projectId);
    return this.db.prepare('SELECT * FROM datasets WHERE project_id = ? ORDER BY created_at, rowid').all(projectId).map(serializeDataset);
  }

  getDataset(id) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    return row ? serializeDataset(row) : undefined;
  }

  async convertRasterToCog(filePath, datasetId, options = {}) {
    const derivedDir = path.join(this.dataDir, 'derived', datasetId);
    await fs.rm(derivedDir, { recursive: true, force: true });
    await fs.mkdir(derivedDir, { recursive: true });
    const cogPath = path.join(derivedDir, 'data.cog.tif');
    const tilesDir = path.join(derivedDir, 'tiles');
    const baseProfile = {
      sourceFormat: 'geotiff',
      originalUri: filePath,
      fileName: options.fileName || path.basename(filePath),
      sizeBytes: options.sizeBytes,
    };
    try {
      await execFileAsync('gdal_translate', [
        '-q',
        '-of', 'COG',
        '-co', 'COMPRESS=DEFLATE',
        '-co', 'BIGTIFF=IF_SAFER',
        '-co', 'OVERVIEWS=AUTO',
        filePath,
        cogPath,
      ], { maxBuffer: 20 * 1024 * 1024 });
      const infoText = (await execFileAsync('gdalinfo', ['-json', cogPath], { maxBuffer: 20 * 1024 * 1024 })).stdout;
      const info = JSON.parse(infoText);
      const bbox = bboxFromGdalInfo(info);
      const crs = epsgFromGdalInfo(info) || (bbox ? 4326 : null);
      const maxZoom = chooseMaxZoom(bbox);
      await fs.mkdir(tilesDir, { recursive: true });
      await execFileAsync('gdal2tiles.py', [
        '--xyz',
        '-p', 'mercator',
        '-w', 'none',
        '-r', 'bilinear',
        '-z', '0-' + maxZoom,
        '--processes=1',
        '--quiet',
        cogPath,
        tilesDir,
      ], { maxBuffer: 20 * 1024 * 1024 });
      return {
        uri: cogPath,
        crs,
        bbox,
        profile: Object.assign({}, baseProfile, {
          format: 'cog',
          renderable: Boolean(bbox),
          cogPath,
          tilePath: tilesDir,
          tileSize: 256,
          minzoom: 0,
          maxzoom: maxZoom,
          bbox,
          note: bbox ? undefined : 'The COG has no WGS84 extent, so it cannot be placed on the map.',
        }),
      };
    } catch (error) {
      return {
        uri: filePath,
        crs: null,
        bbox: null,
        profile: Object.assign({}, baseProfile, {
          format: 'geotiff',
          renderable: false,
          conversionError: gdalError(error),
        }),
      };
    }
  }

  async convertDatasetToCog(id, options = {}) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Dataset not found');
    const profile = jsonParse(row.profile, {});
    if (!options.force && profile.format === 'cog' && profile.renderable) return serializeDataset(row);
    const sourcePath = profile.originalUri || row.uri;
    const ext = path.extname(sourcePath).toLowerCase();
    if (ext !== '.tif' && ext !== '.tiff') throw httpError(400, 'Only GeoTIFF datasets can be converted to COG');
    const stat = await fs.stat(sourcePath).catch(() => undefined);
    if (!stat) throw httpError(404, 'Dataset source file not found');
    const converted = await this.convertRasterToCog(sourcePath, id, {
      fileName: profile.fileName || path.basename(sourcePath),
      sizeBytes: stat.size,
    });
    this.db.prepare('UPDATE datasets SET uri = ?, crs = ?, bbox = ?, profile = ? WHERE id = ?').run(
      converted.uri,
      converted.crs,
      converted.bbox ? jsonString(converted.bbox, null) : null,
      jsonString(converted.profile, {}),
      id,
    );
    return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
  }

  sanitizeDatabase(row) {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      host: row.host,
      port: row.port,
      dbname: row.dbname,
      username: row.username,
      sslmode: row.sslmode,
      createdAt: row.created_at,
    };
  }

  listDatabases(projectId) {
    this.assertProject(projectId);
    return this.db.prepare('SELECT * FROM databases WHERE project_id = ? ORDER BY created_at, rowid').all(projectId)
      .map((row) => this.sanitizeDatabase(row));
  }

  async fetchPostgisTables(config) {
    const env = Object.assign({}, process.env, { GIS_PG_CONFIG: JSON.stringify(config) });
    try {
      const { stdout } = await execFileAsync('python3', [PG_TABLES_SCRIPT], { env, maxBuffer: 20 * 1024 * 1024 });
      const data = JSON.parse(stdout);
      if (data.error) throw httpError(400, data.error);
      return Array.isArray(data.tables) ? data.tables : [];
    } catch (error) {
      if (error && error.status) throw error;
      let message = error && error.message ? error.message : 'PostgreSQL connection failed';
      try {
        const payload = JSON.parse(error.stdout || '{}');
        if (payload.error) message = payload.error;
      } catch (parseError) {
        // Keep the process error.
      }
      throw httpError(400, message);
    }
  }

  async createDatabase(projectId, input = {}) {
    this.assertProject(projectId);
    const name = String(input.name || '').trim() || 'PostgreSQL';
    const host = String(input.host || '').trim();
    const port = Math.min(65535, Math.max(1, Number(input.port) || 5432));
    const dbname = String(input.dbname || '').trim();
    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    const sslmode = String(input.sslmode || 'prefer').trim() || 'prefer';
    if (!host || !dbname || !username) throw httpError(400, 'host, dbname, and username are required');
    await this.fetchPostgisTables({ host, port, dbname, username, password, sslmode });
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO databases (id, project_id, name, host, port, dbname, username, password, sslmode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name.slice(0, 120), host, port, dbname, username, password, sslmode);
    return this.sanitizeDatabase(this.db.prepare('SELECT * FROM databases WHERE id = ?').get(id));
  }

  async listDatabaseTables(id) {
    const row = this.db.prepare('SELECT * FROM databases WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Database registration not found');
    const tables = await this.fetchPostgisTables({
      host: row.host,
      port: row.port,
      dbname: row.dbname,
      username: row.username,
      password: row.password,
      sslmode: row.sslmode,
    });
    return tables.map((table) => Object.assign({ databaseId: id }, table));
  }

  deleteDatabase(id) {
    const result = this.db.prepare('DELETE FROM databases WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async importPostgisTable(databaseId, input = {}) {
    const database = this.db.prepare('SELECT * FROM databases WHERE id = ?').get(databaseId);
    if (!database) throw httpError(404, 'Database registration not found');
    this.assertProject(database.project_id);
    const schema = String(input.schema || 'public');
    const tableName = String(input.table || '').trim();
    if (!tableName) throw httpError(400, 'table is required');
    const tables = await this.fetchPostgisTables({
      host: database.host,
      port: database.port,
      dbname: database.dbname,
      username: database.username,
      password: database.password,
      sslmode: database.sslmode,
    });
    const source = tables.find((item) => item.schema === schema && item.table === tableName);
    if (!source) throw httpError(404, 'Spatial table not found');
    const projectId = database.project_id;
    const id = randomUUID();
    const targetTable = 'ds_' + id.replace(/-/g, '');
    const gpkgPath = await this.projectGpkgPath(projectId);
    const derivedDir = path.join(this.dataDir, 'derived', id);
    await fs.mkdir(derivedDir, { recursive: true });
    const previewPath = path.join(derivedDir, 'preview.geojson');
    const connection = 'PG:host=' + database.host + ' port=' + database.port + ' dbname=' + database.dbname
      + ' user=' + database.username + ' sslmode=' + database.sslmode;
    const env = Object.assign({}, process.env, { PGPASSWORD: database.password });
    try {
      await execFileAsync('ogr2ogr', [
        '-f', 'GPKG',
        '-t_srs', 'EPSG:4326',
        '-lco', 'SPATIAL_INDEX=YES',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-makevalid',
        '-nln', targetTable,
        gpkgPath,
        connection,
        source.schema + '.' + source.table,
      ], { env, maxBuffer: 20 * 1024 * 1024 });
      const info = JSON.parse((await execFileAsync('python3', [VECTOR_INFO_SCRIPT, gpkgPath, targetTable], {
        maxBuffer: 20 * 1024 * 1024,
      })).stdout);
      const layer = info.layer || {};
      const bbox = Array.isArray(layer.bbox) && layer.bbox.length === 4 && layer.bbox.every(Number.isFinite)
        ? layer.bbox.map(Number)
        : null;
      await execFileAsync('ogr2ogr', [
        '-f', 'GeoJSON', '-t_srs', 'EPSG:4326', previewPath, gpkgPath, targetTable,
      ], { maxBuffer: 20 * 1024 * 1024 });
      const previewStat = await fs.stat(previewPath);
      const profile = {
        format: 'gpkg',
        storage: 'project-gpkg',
        sourceFormat: 'postgis',
        databaseId,
        databaseName: database.name,
        sourceSchema: source.schema,
        sourceTable: source.table,
        geometryColumn: source.geometryColumn,
        geometryType: source.geometryType,
        name: source.table,
        layerName: source.table,
        fileName: source.schema + '.' + source.table,
        gpkgPath,
        tableName: targetTable,
        previewPath,
        previewSizeBytes: previewStat.size,
        updatedAt: new Date().toISOString(),
        featureCount: Number.isFinite(Number(layer.featureCount)) ? Number(layer.featureCount) : 0,
        fields: Array.isArray(layer.fields) ? layer.fields.map((field) => field.name).filter(Boolean) : [],
        bbox,
        crs: 4326,
        renderable: Boolean(bbox),
      };
      this.db.prepare(
        'INSERT INTO datasets (id, project_id, kind, uri, crs, bbox, profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        projectId,
        'vector',
        gpkgPath,
        4326,
        bbox ? jsonString(bbox, null) : null,
        jsonString(profile, {}),
      );
      return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
    } catch (error) {
      await fs.rm(derivedDir, { recursive: true, force: true }).catch(() => {});
      throw httpError(422, 'PostGIS import failed: ' + gdalError(error));
    }
  }

  async projectGpkgPath(projectId) {
    const dir = path.join(this.dataDir, 'projects');
    await fs.mkdir(dir, { recursive: true });
    return path.join(dir, projectId + '.gpkg');
  }

  async listGpkgLayers(gpkgPath) {
    const text = (await execFileAsync('python3', [VECTOR_INFO_SCRIPT, gpkgPath], { maxBuffer: 20 * 1024 * 1024 })).stdout;
    const info = JSON.parse(text);
    return (info.layers || []).map((layer) => layer.name).filter(Boolean);
  }

  async importVectorLayer(projectId, sourcePath, options = {}) {
    const ext = path.extname(sourcePath).toLowerCase();
    const sourceStat = await fs.stat(sourcePath);
    const layerName = String(options.layerName || path.basename(sourcePath, ext) || 'vector').trim() || 'vector';
    const fileName = options.fileName || path.basename(sourcePath);
    const id = randomUUID();
    const tableName = 'ds_' + id.replace(/-/g, '');
    const gpkgPath = await this.projectGpkgPath(projectId);
    const derivedDir = path.join(this.dataDir, 'derived', id);
    await fs.mkdir(derivedDir, { recursive: true });
    const previewPath = path.join(derivedDir, 'preview.geojson');
    try {
      const args = [
        '-f', 'GPKG',
        '-update',
        '-t_srs', 'EPSG:4326',
        '-lco', 'SPATIAL_INDEX=YES',
        '-nlt', 'PROMOTE_TO_MULTI',
        '-makevalid',
        '-nln', tableName,
        gpkgPath,
        sourcePath,
      ];
      if (options.sourceLayer) args.push(options.sourceLayer);
      await execFileAsync('ogr2ogr', args, { maxBuffer: 20 * 1024 * 1024 });
      const info = JSON.parse((await execFileAsync('python3', [VECTOR_INFO_SCRIPT, gpkgPath, tableName], {
        maxBuffer: 20 * 1024 * 1024,
      })).stdout);
      const layer = info.layer || {};
      const bbox = Array.isArray(layer.bbox) && layer.bbox.length === 4 && layer.bbox.every(Number.isFinite)
        ? layer.bbox.map(Number)
        : null;
      await execFileAsync('ogr2ogr', [
        '-f', 'GeoJSON',
        '-t_srs', 'EPSG:4326',
        previewPath,
        gpkgPath,
        tableName,
      ], { maxBuffer: 20 * 1024 * 1024 });
      const previewStat = await fs.stat(previewPath);
      const profile = {
        format: 'gpkg',
        storage: 'project-gpkg',
        sourceFormat: options.sourceFormat || ext.replace(/^\./, ''),
        name: layerName,
        layerName,
        fileName,
        sizeBytes: options.sizeBytes || sourceStat.size,
        originalUri: options.originalUri || sourcePath,
        sourceEntry: options.sourceEntry,
        gpkgPath,
        tableName,
        previewPath,
        previewSizeBytes: previewStat.size,
        updatedAt: new Date().toISOString(),
        featureCount: Number.isFinite(Number(layer.featureCount)) ? Number(layer.featureCount) : 0,
        fields: Array.isArray(layer.fields) ? layer.fields.map((field) => field.name).filter(Boolean) : [],
        bbox,
        crs: 4326,
        renderable: Boolean(bbox),
      };
      this.db.prepare(
        'INSERT INTO datasets (id, project_id, kind, uri, crs, bbox, profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        projectId,
        'vector',
        gpkgPath,
        4326,
        bbox ? jsonString(bbox, null) : null,
        jsonString(profile, {}),
      );
      return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
    } catch (error) {
      throw httpError(422, 'Vector import failed: ' + gdalError(error));
    }
  }

  async importVectorFile(projectId, sourcePath, options = {}) {
    const ext = path.extname(sourcePath).toLowerCase();
    if (ext === '.gpkg') {
      const layers = await this.listGpkgLayers(sourcePath);
      if (layers.length === 0) throw httpError(400, 'GeoPackage contains no vector layers');
      const datasets = [];
      for (const layerName of layers) {
        datasets.push(await this.importVectorLayer(projectId, sourcePath, Object.assign({}, options, {
          sourceFormat: 'gpkg',
          sourceLayer: layerName,
          layerName,
          fileName: options.fileName || path.basename(sourcePath),
        })));
      }
      return datasets;
    }
    return [await this.importVectorLayer(projectId, sourcePath, Object.assign({}, options, {
      sourceFormat: ext.replace(/^\./, ''),
      layerName: options.layerName || path.basename(sourcePath, ext),
    }))];
  }

  async createDatasetsFromPath(projectId, filePath, options = {}) {
    this.assertProject(projectId);
    const realPath = await this.resolveAllowed(filePath);
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw httpError(400, 'Dataset path must be a file');
    if (stat.size > MAX_FILE_BYTES) throw httpError(413, 'Dataset file is too large');
    const ext = path.extname(realPath).toLowerCase();
    if (ext === '.zip') {
      const importDir = path.join(this.dataDir, 'imports', randomUUID());
      await fs.mkdir(importDir, { recursive: true });
      try {
        await execFileAsync('python3', [UNZIP_SCRIPT, realPath, importDir], { maxBuffer: 20 * 1024 * 1024 });
        const files = await walkFiles(importDir);
        const sources = [];
        for (const file of files) {
          const fileExt = path.extname(file).toLowerCase();
          if (fileExt === '.shp') {
            sources.push({ type: 'shp', path: file });
          } else if (fileExt === '.gpkg') {
            const layers = await this.listGpkgLayers(file);
            for (const layerName of layers) sources.push({ type: 'gpkg', path: file, layerName });
          } else if (fileExt === '.geojson' || (fileExt === '.json' && await isGeoJsonFile(file))) {
            sources.push({ type: 'geojson', path: file });
          }
        }
        if (sources.length === 0) {
          throw httpError(400, '压缩包内没有识别到 SHP、GeoJSON 或 GeoPackage 矢量数据');
        }
        const datasets = [];
        for (const source of sources) {
          const sourceStat = await fs.stat(source.path);
          if (sourceStat.size > MAX_FILE_BYTES) throw httpError(413, 'Extracted vector file is too large');
          const sourceEntry = path.relative(importDir, source.path);
          if (source.type === 'gpkg') {
            datasets.push(await this.importVectorLayer(projectId, source.path, {
              sourceFormat: 'gpkg',
              sourceLayer: source.layerName,
              layerName: source.layerName,
              fileName: path.basename(source.path),
              originalUri: realPath,
              sourceEntry,
              sizeBytes: sourceStat.size,
            }));
          } else {
            datasets.push(...await this.importVectorFile(projectId, source.path, {
              sourceFormat: source.type,
              fileName: path.basename(source.path),
              originalUri: realPath,
              sourceEntry,
              sizeBytes: sourceStat.size,
            }));
          }
        }
        return datasets;
      } finally {
        await fs.rm(importDir, { recursive: true, force: true });
      }
    }
    if (ext === '.gpkg') {
      return this.importVectorFile(projectId, realPath, {
        originalUri: realPath,
        sourceEntry: path.basename(realPath),
        sizeBytes: stat.size,
      });
    }
    if (ext === '.shp' || ext === '.geojson' || (ext === '.json' && await isGeoJsonFile(realPath))) {
      return this.importVectorFile(projectId, realPath, {
        originalUri: realPath,
        sourceEntry: path.basename(realPath),
        sizeBytes: stat.size,
      });
    }
    return [await this.createDatasetFromPath(projectId, realPath, options)];
  }

  async createDatasetFromPath(projectId, filePath, options = {}) {
    this.assertProject(projectId);
    const realPath = await this.resolveAllowed(filePath);
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw httpError(400, 'Dataset path must be a file');
    if (stat.size > MAX_FILE_BYTES) throw httpError(413, 'Dataset file is too large');
    const id = randomUUID();
    const ext = path.extname(realPath).toLowerCase();
    let inspected;
    if (ext === '.tif' || ext === '.tiff') {
      inspected = await this.convertRasterToCog(realPath, id, {
        fileName: options.fileName,
        sizeBytes: stat.size,
      });
      inspected.kind = 'raster';
    } else {
      inspected = await inspectFile(realPath, stat.size, options);
    }
    const storedUri = inspected.uri || realPath;
    this.db.prepare(
      'INSERT INTO datasets (id, project_id, kind, uri, crs, bbox, profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      projectId,
      inspected.kind,
      storedUri,
      inspected.crs,
      inspected.bbox ? jsonString(inspected.bbox, null) : null,
      jsonString(inspected.profile, {}),
    );
    return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
  }

  findLayerRow(layerId) {
    return this.db.prepare(`
      SELECT l.*, d.kind AS dataset_kind, d.uri AS dataset_uri, d.crs AS dataset_crs,
             d.bbox AS dataset_bbox, d.profile AS dataset_profile,
             json_extract(d.profile, '$.format') AS dataset_format
      FROM layers l LEFT JOIN datasets d ON d.id = l.dataset_id
      WHERE l.id = ?
    `).get(layerId);
  }

  projectName(projectId) {
    const row = this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId);
    return row ? row.name : undefined;
  }

  listAllLayers(input = {}) {
    const query = String(input.query || '').trim().toLowerCase();
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
    const output = [];
    for (const project of this.listProjects()) {
      for (const layer of this.listLayers(project.id)) {
        const profile = layer.dataset && layer.dataset.profile ? layer.dataset.profile : {};
        const haystack = [
          layer.name,
          project.name,
          profile.name,
          profile.fileName,
          profile.tableName,
          layer.dataset && layer.dataset.format,
        ].map((value) => String(value || '').toLowerCase());
        if (query && !haystack.some((value) => value.includes(query))) continue;
        output.push({
          layerId: layer.id,
          projectId: project.id,
          projectName: project.name,
          name: layer.name,
          datasetId: layer.datasetId,
          datasetName: profile.name || profile.fileName,
          format: layer.dataset && layer.dataset.format,
          kind: layer.dataset && layer.dataset.kind,
          featureCount: profile.featureCount,
          fields: Array.isArray(profile.fields) ? profile.fields : [],
          bbox: layer.dataset && layer.dataset.bbox,
          visible: layer.visible,
          z: layer.z,
          style: layer.style,
        });
      }
    }
    return output.slice(0, limit);
  }

  describeLayer(layerId) {
    const row = this.findLayerRow(layerId);
    if (!row) throw httpError(404, 'Layer not found');
    const layer = serializeLayer(row);
    const profile = layer.dataset && layer.dataset.profile ? layer.dataset.profile : {};
    return {
      layer,
      projectId: row.project_id,
      projectName: this.projectName(row.project_id),
      fields: Array.isArray(profile.fields) ? profile.fields : [],
      featureCount: profile.featureCount,
      format: layer.dataset && layer.dataset.format,
      kind: layer.dataset && layer.dataset.kind,
      bbox: layer.dataset && layer.dataset.bbox,
      style: layer.style,
      renderable: profile.renderable !== false,
    };
  }

  async sampleLayerField(layerId, field, limitInput) {
    const inputField = String(field || '').trim();
    if (!inputField) throw httpError(400, 'field is required');
    const limit = Math.min(500, Math.max(1, Number(limitInput) || 50));
    const row = this.findLayerRow(layerId);
    if (!row) throw httpError(404, 'Layer not found');
    const profile = jsonParse(row.dataset_profile, {});
    const fields = Array.isArray(profile.fields) ? profile.fields : [];
    if (fields.length > 0 && !fields.includes(inputField)) {
      throw httpError(400, 'Field "' + inputField + '" is not present on this layer. Available fields: ' + fields.join(', '));
    }
    if (profile.format === 'gpkg' && profile.gpkgPath && profile.tableName) {
      const table = String(profile.tableName);
      if (!/^[A-Za-z0-9_]+$/.test(table)) throw httpError(400, 'Invalid GeoPackage table name');
      const quotedField = '"' + inputField.replace(/"/g, '""') + '"';
      const db = new DatabaseSync(profile.gpkgPath, { readOnly: true });
      try {
        const values = db.prepare(`SELECT DISTINCT ${quotedField} AS value FROM "${table}" WHERE ${quotedField} IS NOT NULL LIMIT ?`)
          .all(limit + 1)
          .map((item) => item.value);
        return {
          layerId,
          field: inputField,
          values: values.slice(0, limit),
          truncated: values.length > limit,
        };
      } finally {
        db.close();
      }
    }
    if (profile.format === 'geojson') {
      const sourcePath = profile.previewPath || row.dataset_uri;
      const text = await fs.readFile(sourcePath, 'utf8');
      const parsed = JSON.parse(text);
      const values = [];
      const seen = new Set();
      for (const feature of Array.isArray(parsed.features) ? parsed.features : []) {
        const value = feature && feature.properties ? feature.properties[inputField] : undefined;
        if (value === undefined || value === null) continue;
        const key = String(value);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
        if (values.length > limit) break;
      }
      return {
        layerId,
        field: inputField,
        values: values.slice(0, limit),
        truncated: values.length > limit,
      };
    }
    throw httpError(415, 'This layer format does not expose attribute fields');
  }

  updateLayerStyle(layerId, stylePatch) {
    this.findLayerRow(layerId);
    const row = this.db.prepare('SELECT * FROM layers WHERE id = ?').get(layerId);
    if (!row) throw httpError(404, 'Layer not found');
    const base = jsonParse(row.style, {});
    let merged;
    try {
      merged = mergeLayerStyle(base, stylePatch);
    } catch (error) {
      throw httpError(400, error.message);
    }
    const datasetRow = this.db.prepare('SELECT profile FROM datasets WHERE id = ?').get(row.dataset_id);
    const datasetProfile = datasetRow ? jsonParse(datasetRow.profile, {}) : {};
    const fields = Array.isArray(datasetProfile.fields) ? datasetProfile.fields : [];
    if (merged.label && merged.label.field && fields.length > 0 && !fields.includes(merged.label.field)) {
      throw httpError(400, 'Label field "' + merged.label.field + '" is not present. Available fields: ' + fields.join(', '));
    }
    if (merged.categorical && merged.categorical.field && fields.length > 0 && !fields.includes(merged.categorical.field)) {
      throw httpError(400, 'Categorical field "' + merged.categorical.field + '" is not present. Available fields: ' + fields.join(', '));
    }
    this.db.prepare('UPDATE layers SET style = ? WHERE id = ?').run(jsonString(merged, {}), layerId);
    const updated = this.listLayers(row.project_id).find((layer) => layer.id === layerId);
    return { layer: updated, style: merged, projectId: row.project_id, projectName: this.projectName(row.project_id) };
  }

  mapCapabilities() {
    return {
      styleSchema: STYLE_SCHEMA,
      fonts: STYLE_SCHEMA.fonts,
      glyphsUrl: STYLE_SCHEMA.glyphsUrl,
      supportsLabel: true,
      notes: 'Label text uses the default MapLibre font stack; CJK glyphs are rendered locally by the browser. Unknown label.range glyph requests fall back to local rendering.',
    };
  }

  async updateVectorFeature(datasetId, input = {}) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId);
    if (!row) throw httpError(404, 'Dataset not found');
    const profile = jsonParse(row.profile, {});
    if (profile.sourceFormat !== 'drawn' || !profile.tableName || !profile.gpkgPath) {
      throw httpError(400, 'This dataset is not an editable polygon layer');
    }
    const geometry = input.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
      throw httpError(400, 'geometry must be a GeoJSON Polygon or MultiPolygon');
    }
    const env = Object.assign({}, process.env, {
      GIS_VECTOR_EDIT: JSON.stringify({
        gpkg: profile.gpkgPath,
        table: profile.tableName,
        geometry,
        name: input.name,
        createdAt: input.createdAt,
      }),
    });
    try {
      const output = await execFileAsync('python3', [VECTOR_EDIT_SCRIPT, 'update'], { env, maxBuffer: 20 * 1024 * 1024 });
      const result = JSON.parse(output.stdout || '{}');
      if (!result.updated) throw httpError(404, 'Feature not found');
      await execFileAsync('ogr2ogr', [
        '-f', 'GeoJSON', '-t_srs', 'EPSG:4326', profile.previewPath, profile.gpkgPath, profile.tableName,
      ], { maxBuffer: 20 * 1024 * 1024 });
      const info = JSON.parse((await execFileAsync('python3', [VECTOR_INFO_SCRIPT, profile.gpkgPath, profile.tableName], {
        maxBuffer: 20 * 1024 * 1024,
      })).stdout);
      const layer = info.layer || {};
      const previewData = JSON.parse(await fs.readFile(profile.previewPath, 'utf8'));
      const bounds = geoJsonBounds(previewData);
      const bbox = bounds.bbox;
      const previewStat = await fs.stat(profile.previewPath);
      const nextProfile = Object.assign({}, profile, {
        bbox,
        previewSizeBytes: previewStat.size,
        updatedAt: new Date().toISOString(),
        featureCount: bounds.count,
        fields: Array.isArray(layer.fields) ? layer.fields.map((field) => field.name).filter(Boolean) : profile.fields,
        renderable: true,
      });
      this.db.prepare('UPDATE datasets SET bbox = ?, profile = ? WHERE id = ?').run(
        bbox ? jsonString(bbox, null) : null,
        jsonString(nextProfile, {}),
        datasetId,
      );
      return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId));
    } catch (error) {
      if (error && error.status) throw error;
      throw httpError(422, 'Could not update feature: ' + gdalError(error));
    }
  }

  async deleteVectorFeature(datasetId, input = {}) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId);
    if (!row) throw httpError(404, 'Dataset not found');
    const profile = jsonParse(row.profile, {});
    if (profile.sourceFormat !== 'drawn' || !profile.tableName || !profile.gpkgPath) {
      throw httpError(400, 'This dataset is not an editable polygon layer');
    }
    const name = input.name !== undefined ? String(input.name) : undefined;
    const createdAt = input.createdAt !== undefined ? String(input.createdAt) : undefined;
    if ((name === undefined || name === '') && (createdAt === undefined || createdAt === '')) {
      throw httpError(400, 'Feature name or createdAt is required');
    }
    const env = Object.assign({}, process.env, {
      GIS_VECTOR_EDIT: JSON.stringify({
        gpkg: profile.gpkgPath,
        table: profile.tableName,
        name,
        createdAt,
      }),
    });
    try {
      const output = await execFileAsync('python3', [VECTOR_EDIT_SCRIPT, 'delete'], { env, maxBuffer: 20 * 1024 * 1024 });
      const result = JSON.parse(output.stdout || '{}');
      if (!result.deleted) throw httpError(404, 'Feature not found');
      await execFileAsync('ogr2ogr', [
        '-f', 'GeoJSON', '-t_srs', 'EPSG:4326', profile.previewPath, profile.gpkgPath, profile.tableName,
      ], { maxBuffer: 20 * 1024 * 1024 });
      const info = JSON.parse((await execFileAsync('python3', [VECTOR_INFO_SCRIPT, profile.gpkgPath, profile.tableName], {
        maxBuffer: 20 * 1024 * 1024,
      })).stdout);
      const layer = info.layer || {};
      const previewData = JSON.parse(await fs.readFile(profile.previewPath, 'utf8'));
      const bounds = geoJsonBounds(previewData);
      const bbox = bounds.bbox;
      const previewStat = await fs.stat(profile.previewPath);
      const nextProfile = Object.assign({}, profile, {
        bbox,
        previewSizeBytes: previewStat.size,
        updatedAt: new Date().toISOString(),
        featureCount: bounds.count,
        fields: Array.isArray(layer.fields) ? layer.fields.map((field) => field.name).filter(Boolean) : profile.fields,
        renderable: true,
      });
      this.db.prepare('UPDATE datasets SET bbox = ?, profile = ? WHERE id = ?').run(
        bbox ? jsonString(bbox, null) : null,
        jsonString(nextProfile, {}),
        datasetId,
      );
      return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId));
    } catch (error) {
      if (error && error.status) throw error;
      throw httpError(422, 'Could not delete feature: ' + gdalError(error));
    }
  }

  async createVectorLayer(projectId, input = {}) {
    this.assertProject(projectId);
    const name = String(input.name || '').trim() || '新建矢量图层';
    const id = randomUUID();
    const tableName = 'ds_' + id.replace(/-/g, '');
    const gpkgPath = await this.projectGpkgPath(projectId);
    const derivedDir = path.join(this.dataDir, 'derived', id);
    await fs.mkdir(derivedDir, { recursive: true });
    const previewPath = path.join(derivedDir, 'preview.geojson');
    const env = Object.assign({}, process.env, {
      GIS_VECTOR_EDIT: JSON.stringify({ gpkg: gpkgPath, table: tableName }),
    });
    try {
      await execFileAsync('python3', [VECTOR_EDIT_SCRIPT, 'create'], { env, maxBuffer: 20 * 1024 * 1024 });
      await fs.writeFile(previewPath, JSON.stringify({ type: 'FeatureCollection', features: [] }), 'utf8');
      const previewStat = await fs.stat(previewPath);
      const profile = {
        format: 'gpkg',
        storage: 'project-gpkg',
        sourceFormat: 'drawn',
        name,
        layerName: name,
        fileName: name + '.gpkg',
        gpkgPath,
        tableName,
        previewPath,
        previewSizeBytes: previewStat.size,
        updatedAt: new Date().toISOString(),
        featureCount: 0,
        fields: ['name', 'created_at'],
        bbox: null,
        crs: 4326,
        renderable: true,
      };
      this.db.prepare(
        'INSERT INTO datasets (id, project_id, kind, uri, crs, bbox, profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, projectId, 'vector', gpkgPath, 4326, null, jsonString(profile, {}));
      return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
    } catch (error) {
      await fs.rm(derivedDir, { recursive: true, force: true }).catch(() => {});
      throw httpError(422, 'Could not create vector layer: ' + gdalError(error));
    }
  }

  async addVectorFeature(datasetId, input = {}) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId);
    if (!row) throw httpError(404, 'Dataset not found');
    const profile = jsonParse(row.profile, {});
    if (profile.sourceFormat !== 'drawn' || !profile.tableName || !profile.gpkgPath) {
      throw httpError(400, 'This dataset is not an editable polygon layer');
    }
    const geometry = input.geometry;
    if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
      throw httpError(400, 'geometry must be a GeoJSON Polygon or MultiPolygon');
    }
    const count = Number(profile.featureCount) || 0;
    const featureName = String(input.name || '').trim() || ('多边形 ' + (count + 1));
    const createdAt = new Date().toISOString();
    const env = Object.assign({}, process.env, {
      GIS_VECTOR_EDIT: JSON.stringify({
        gpkg: profile.gpkgPath,
        table: profile.tableName,
        geometry,
        name: featureName,
        createdAt,
      }),
    });
    try {
      await execFileAsync('python3', [VECTOR_EDIT_SCRIPT, 'add'], { env, maxBuffer: 20 * 1024 * 1024 });
      await execFileAsync('ogr2ogr', [
        '-f', 'GeoJSON', '-t_srs', 'EPSG:4326', profile.previewPath, profile.gpkgPath, profile.tableName,
      ], { maxBuffer: 20 * 1024 * 1024 });
      const info = JSON.parse((await execFileAsync('python3', [VECTOR_INFO_SCRIPT, profile.gpkgPath, profile.tableName], {
        maxBuffer: 20 * 1024 * 1024,
      })).stdout);
      const layer = info.layer || {};
      const previewData = JSON.parse(await fs.readFile(profile.previewPath, 'utf8'));
      const bounds = geoJsonBounds(previewData);
      const bbox = bounds.bbox;
      const previewStat = await fs.stat(profile.previewPath);
      const nextProfile = Object.assign({}, profile, {
        bbox,
        previewSizeBytes: previewStat.size,
        updatedAt: new Date().toISOString(),
        featureCount: bounds.count,
        fields: Array.isArray(layer.fields) ? layer.fields.map((field) => field.name).filter(Boolean) : profile.fields,
        renderable: true,
      });
      this.db.prepare('UPDATE datasets SET bbox = ?, profile = ? WHERE id = ?').run(
        bbox ? jsonString(bbox, null) : null,
        jsonString(nextProfile, {}),
        datasetId,
      );
      return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(datasetId));
    } catch (error) {
      throw httpError(422, 'Could not add polygon: ' + gdalError(error));
    }
  }

  createTileDataset(projectId, input = {}) {
    this.assertProject(projectId);
    const uri = String(input.tileUrl || input.uri || '').trim();
    if (!isTileTemplate(uri)) throw httpError(400, 'tileUrl must be an XYZ tile template containing {z}, {x}, and {y}');
    const id = randomUUID();
    const profile = {
      format: 'xyz',
      renderable: true,
      tileSize: Number(input.tileSize) === 512 ? 512 : 256,
      attribution: String(input.attribution || '天地图'),
      name: String(input.name || '天地图影像'),
    };
    this.db.prepare(
      'INSERT INTO datasets (id, project_id, kind, uri, crs, bbox, profile) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, projectId, 'raster', uri, 3857, null, jsonString(profile, {}));
    return serializeDataset(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id));
  }

  listLayers(projectId) {
    this.assertProject(projectId);
    return this.db.prepare(`
      SELECT l.*, d.kind AS dataset_kind, d.uri AS dataset_uri, d.crs AS dataset_crs,
             d.bbox AS dataset_bbox, d.profile AS dataset_profile,
             json_extract(d.profile, '$.format') AS dataset_format
      FROM layers l LEFT JOIN datasets d ON d.id = l.dataset_id
      WHERE l.project_id = ? ORDER BY l.z, l.rowid
    `).all(projectId).map(serializeLayer);
  }

  replaceProjectLayerState(projectId, input = {}) {
    this.assertProject(projectId);
    const requested = Array.isArray(input.layers) ? input.layers : [];
    const layers = [];
    const seen = new Set();
    for (const raw of requested) {
      if (!raw || typeof raw !== 'object') continue;
      const datasetId = String(raw.datasetId || '');
      if (!datasetId) continue;
      const dataset = this.db.prepare('SELECT * FROM datasets WHERE id = ? AND project_id = ?').get(datasetId, projectId);
      if (!dataset) throw httpError(400, 'A layer references a dataset outside this project');
      const id = String(raw.id || randomUUID());
      if (seen.has(id)) throw httpError(400, 'Duplicate layer id in the project state');
      seen.add(id);
      const profile = jsonParse(dataset.profile, {});
      const name = String(raw.name || '').trim()
        || profile.name
        || profile.fileName
        || path.basename(dataset.uri)
        || '未命名图层';
      const style = raw.style && typeof raw.style === 'object' ? raw.style : {};
      layers.push({
        id,
        datasetId,
        name,
        style,
        visible: raw.visible === false ? 0 : 1,
        z: Number.isFinite(Number(raw.z)) ? Number(raw.z) : 0,
      });
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (input.meta !== undefined && input.meta !== null) {
        this.db.prepare('UPDATE projects SET meta = ? WHERE id = ?').run(jsonString(input.meta, {}), projectId);
      }
      this.db.prepare('DELETE FROM layers WHERE project_id = ?').run(projectId);
      const insert = this.db.prepare(
        'INSERT INTO layers (id, project_id, dataset_id, name, style, visible, z) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      for (const layer of layers) {
        insert.run(layer.id, projectId, layer.datasetId, layer.name, jsonString(layer.style, {}), layer.visible, layer.z);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch (rollbackError) {
        // Preserve the original failure.
      }
      throw error;
    }
    return this.listLayers(projectId);
  }

  createLayer(projectId, input = {}) {
    this.assertProject(projectId);
    if (!input.datasetId) throw httpError(400, 'datasetId is required');
    const dataset = this.db.prepare('SELECT * FROM datasets WHERE id = ? AND project_id = ?').get(input.datasetId, projectId);
    if (!dataset) throw httpError(404, 'Dataset not found in this project');
    const max = this.db.prepare('SELECT COALESCE(MAX(z), -1) AS z FROM layers WHERE project_id = ?').get(projectId).z;
    const id = randomUUID();
    const datasetProfile = jsonParse(dataset.profile, {});
    const name = String(input.name || '').trim()
      || datasetProfile.name
      || datasetProfile.fileName
      || path.basename(dataset.uri)
      || '未命名图层';
    const z = Number.isFinite(Number(input.z)) ? Number(input.z) : max + 1;
    const style = input.style && typeof input.style === 'object' ? input.style : {};
    const visible = input.visible === false ? 0 : 1;
    this.db.prepare(
      'INSERT INTO layers (id, project_id, dataset_id, name, style, visible, z) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, projectId, input.datasetId, name, jsonString(style, {}), visible, z);
    return this.listLayers(projectId).find((layer) => layer.id === id);
  }

  updateLayer(id, input = {}) {
    const row = this.db.prepare('SELECT * FROM layers WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Layer not found');
    const name = input.name === undefined ? row.name : String(input.name);
    const style = input.style === undefined ? jsonParse(row.style, {}) : input.style;
    const visible = input.visible === undefined ? row.visible : input.visible ? 1 : 0;
    const z = input.z === undefined ? row.z : Number(input.z);
    this.db.prepare('UPDATE layers SET name = ?, style = ?, visible = ?, z = ? WHERE id = ?')
      .run(name, jsonString(style, {}), visible, z, id);
    return this.listLayers(row.project_id).find((layer) => layer.id === id);
  }

  deleteLayer(id) {
    const result = this.db.prepare('DELETE FROM layers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async deleteDataset(id) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    if (!row) return false;
    const profile = jsonParse(row.profile, {});
    const result = this.db.prepare('DELETE FROM datasets WHERE id = ?').run(id);
    if (result.changes > 0) {
      if (profile.format === 'gpkg' && profile.gpkgPath && profile.tableName) {
        await execFileAsync('python3', [DROP_LAYER_SCRIPT, profile.gpkgPath, profile.tableName], { maxBuffer: 20 * 1024 * 1024 })
          .catch((error) => console.warn('[gis-workbench] could not drop GeoPackage layer', error.message));
      }
      if (profile.previewPath) {
        await fs.rm(path.dirname(profile.previewPath), { recursive: true, force: true }).catch(() => {});
      }
      if (profile.format === 'cog' && profile.cogPath) {
        await fs.rm(path.dirname(profile.cogPath), { recursive: true, force: true }).catch(() => {});
      }
    }
    return result.changes > 0;
  }

  rootsForClient() {
    return this.roots.slice();
  }

  async resolveAllowed(inputPath) {
    if (!inputPath || typeof inputPath !== 'string') throw httpError(400, 'Path is required');
    let real;
    try {
      real = await fs.realpath(path.resolve(inputPath));
    } catch (error) {
      throw httpError(404, 'Path does not exist');
    }
    if (!this.roots.some((root) => isInside(root, real))) {
      throw httpError(403, 'Path is outside the allowed data roots');
    }
    return real;
  }

  async browse(inputPath) {
    const target = inputPath ? await this.resolveAllowed(inputPath) : this.workspaceRoot;
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) throw httpError(400, 'Path is not a directory');
    const dirents = await fs.readdir(target, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents.slice(0, 500)) {
      const entryPath = path.join(target, dirent.name);
      let entryStat;
      try {
        entryStat = await fs.stat(entryPath);
      } catch (error) {
        continue;
      }
      const isDirectory = entryStat.isDirectory();
      const ext = path.extname(dirent.name).toLowerCase();
      entries.push({
        name: dirent.name,
        path: entryPath,
        type: isDirectory ? 'directory' : 'file',
        size: isDirectory ? null : entryStat.size,
        extension: ext,
        kindHint: isDirectory ? null : kindHint(dirent.name),
        supported: isDirectory || ALLOWED_FILE_EXTENSIONS.has(ext),
      });
    }
    entries.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
      return left.name.localeCompare(right.name, 'zh-CN');
    });
    const parent = target === this.workspaceRoot ? null : path.dirname(target);
    return {
      root: this.workspaceRoot,
      roots: this.rootsForClient(),
      path: target,
      parent: parent && this.roots.some((root) => isInside(root, parent)) ? parent : null,
      entries,
    };
  }

  async tileInfo(id, z, x, y) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Dataset not found');
    const profile = jsonParse(row.profile, {});
    if (profile.format !== 'cog' || !profile.tilePath) throw httpError(404, 'This dataset has no tile pyramid');
    const zz = Number(z);
    const xx = Number(x);
    const yy = Number(y);
    if (![zz, xx, yy].every(Number.isInteger)) throw httpError(400, 'Invalid tile coordinates');
    const tilePath = path.join(profile.tilePath, String(zz), String(xx), String(yy) + '.png');
    const resolved = path.resolve(tilePath);
    if (!isInside(profile.tilePath, resolved)) throw httpError(400, 'Invalid tile path');
    const stat = await fs.stat(resolved).catch(() => undefined);
    if (!stat || !stat.isFile()) throw httpError(404, 'Tile not found');
    return { filePath: resolved, size: stat.size };
  }

  async contentInfo(id) {
    const row = this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Dataset not found');
    const profile = jsonParse(row.profile, {});
    if (profile.format === 'gpkg') {
      if (!profile.previewPath) throw httpError(415, 'This GeoPackage dataset has no display preview');
      const previewPath = await this.resolveAllowed(profile.previewPath);
      const previewStat = await fs.stat(previewPath);
      if (!previewStat.isFile()) throw httpError(404, 'Dataset preview not found');
      return {
        filePath: previewPath,
        mime: 'application/geo+json; charset=utf-8',
        size: previewStat.size,
        fileName: path.basename(previewPath),
      };
    }
    if (!row.uri || isTileTemplate(row.uri)) throw httpError(415, 'This dataset does not have a file body');
    if (!['geojson', 'csv', 'image', 'cog'].includes(profile.format)) {
      throw httpError(415, 'This dataset format cannot be previewed in the browser');
    }
    const realPath = await this.resolveAllowed(row.uri);
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) throw httpError(404, 'Dataset file not found');
    return {
      filePath: realPath,
      mime: mimeForFormat(profile.format, realPath),
      size: stat.size,
      fileName: path.basename(realPath),
    };
  }


  async initUpload(projectId, input = {}) {
    this.assertProject(projectId);
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size < 0) throw httpError(400, 'A valid file size is required');
    if (size > MAX_FILE_BYTES) throw httpError(413, 'File exceeds the 100 GB limit');
    const fileName = String(input.fileName || '').trim() || 'upload.bin';
    const fingerprint = String(input.fingerprint || '').trim().slice(0, 240);
    const requestedChunk = Number(input.chunkSize) || 8 * 1024 * 1024;
    let chunkSize = Math.min(MAX_CHUNK_BYTES, Math.max(1024 * 1024, Math.floor(requestedChunk)));
    const existing = fingerprint
      ? this.db.prepare(`
          SELECT * FROM uploads
          WHERE project_id = ? AND fingerprint = ? AND status = 'uploading' AND size = ?
          ORDER BY created_at DESC LIMIT 1
        `).get(projectId, fingerprint, size)
      : undefined;
    if (existing) {
      chunkSize = existing.chunk_size;
      try {
        await fs.stat(existing.temp_path);
      } catch (error) {
        this.db.prepare("UPDATE uploads SET received = '[]', updated_at = datetime('now') WHERE id = ?").run(existing.id);
        existing.received = '[]';
      }
      return serializeUpload(existing);
    }
    const id = randomUUID();
    const tempPath = path.join(this.uploadsDir, '.' + id + '.part');
    await fs.writeFile(tempPath, Buffer.alloc(0), { flag: 'w' });
    const totalChunks = chunkSize > 0 ? Math.ceil(size / chunkSize) : 0;
    this.db.prepare(`
      INSERT INTO uploads (id, project_id, fingerprint, file_name, size, chunk_size, total_chunks, received, temp_path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, 'uploading')
    `).run(id, projectId, fingerprint || null, fileName, size, chunkSize, totalChunks, tempPath);
    return serializeUpload(this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id));
  }

  getUpload(id) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Upload not found');
    return serializeUpload(row);
  }

  async writeUploadChunk(id, index, buffer) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Upload not found');
    if (row.status !== 'uploading') throw httpError(409, 'Upload is not accepting chunks');
    const chunkIndex = Number(index);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= row.total_chunks) {
      throw httpError(400, 'Chunk index is out of range');
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'Chunk body is empty');
    const offset = chunkIndex * row.chunk_size;
    const expected = Math.min(row.chunk_size, row.size - offset);
    if (buffer.length !== expected) {
      throw httpError(400, `Chunk ${chunkIndex} must be ${expected} bytes, got ${buffer.length}`);
    }
    let handle;
    try {
      handle = await fs.open(row.temp_path, 'r+');
    } catch (error) {
      handle = await fs.open(row.temp_path, 'w+');
    }
    try {
      await handle.write(buffer, 0, buffer.length, offset);
    } finally {
      await handle.close();
    }
    const received = new Set(jsonParse(row.received, []));
    received.add(chunkIndex);
    this.db.prepare("UPDATE uploads SET received = ?, updated_at = datetime('now') WHERE id = ?")
      .run(jsonString([...received].sort((left, right) => left - right), []), id);
    return serializeUpload(this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id));
  }

  async completeUpload(id, options = {}) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Upload not found');
    if (row.status !== 'uploading') throw httpError(409, 'Upload is not in progress');
    const received = new Set(jsonParse(row.received, []));
    const missing = [];
    for (let index = 0; index < row.total_chunks; index += 1) {
      if (!received.has(index)) missing.push(index);
    }
    if (missing.length > 0) throw httpError(400, 'Upload is missing chunks: ' + missing.slice(0, 20).join(', '));
    const stat = await fs.stat(row.temp_path).catch(() => undefined);
    if (!stat) throw httpError(404, 'Upload temporary file is missing');
    if (stat.size < row.size) throw httpError(400, 'Upload file is incomplete');
    const finalPath = path.join(this.uploadsDir, `${Date.now()}-${randomUUID()}-${safeUploadName(row.file_name)}`);
    await fs.rename(row.temp_path, finalPath);
    let datasets;
    try {
      datasets = await this.createDatasetsFromPath(row.project_id, finalPath, { fileName: row.file_name });
    } catch (error) {
      this.db.prepare("UPDATE uploads SET status = 'failed', temp_path = ?, updated_at = datetime('now') WHERE id = ?")
        .run(finalPath, id);
      throw error;
    }
    const layers = [];
    if (options.addLayer !== false) {
      for (const dataset of datasets) {
        if (dataset.profile && dataset.profile.renderable !== false) {
          layers.push(this.createLayer(row.project_id, { datasetId: dataset.id }));
        }
      }
    }
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
    return {
      datasets,
      layers,
      dataset: datasets[0] || null,
      layer: layers[0] || null,
    };
  }

  async deleteUpload(id) {
    const row = this.db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'Upload not found');
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
    await fs.rm(row.temp_path, { force: true }).catch(() => {});
    return true;
  }

  createReadStream(filePath) {
    return createReadStream(filePath);
  }
}

export { API_PREFIX, MAX_CHUNK_BYTES, MAX_FILE_BYTES, httpError, isTileTemplate, parseBbox, parseCrs };