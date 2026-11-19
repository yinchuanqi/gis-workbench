import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { API_PREFIX, MAX_CHUNK_BYTES, httpError, isTileTemplate } from './store.js';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const GLYPH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'glyphs');

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendNoContent(res, status = 204) {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

async function readBody(req, limit = MAX_UPLOAD_BYTES) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw httpError(413, 'Request body is too large');
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw httpError(413, 'Request body is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const body = await readBody(req, limit);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body.toString('utf8'));
  } catch (error) {
    throw httpError(400, 'Request body must be valid JSON');
  }
}

function decodeSegments(pathname) {
  if (!pathname.startsWith(API_PREFIX)) return null;
  const rest = pathname.slice(API_PREFIX.length);
  if (rest === '' || rest === '/') return [];
  return rest.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
}

function safeUploadName(name) {
  const base = path.basename(String(name || 'upload.bin'));
  const sanitized = base.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '');
  return (sanitized || 'upload.bin').slice(-140);
}

async function parseUpload(req) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw httpError(415, 'Upload must be multipart/form-data');
  }
  const buffer = await readBody(req);
  let form;
  try {
    const request = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: buffer,
    });
    form = await request.formData();
  } catch (error) {
    throw httpError(400, 'Could not parse the upload form');
  }
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') throw httpError(400, 'A file field is required');
  return { form, file };
}

export function createApiHandler(store) {
  return async function gisWorkbenchApi(req, res) {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const segments = decodeSegments(url.pathname);
      if (segments === null) throw httpError(404, 'Not found');
      const method = String(req.method || 'GET').toUpperCase();

      if (segments.length === 0 && method === 'GET') {
        const projects = store.listProjects();
        sendJson(res, 200, {
          projects,
          roots: store.rootsForClient(),
          defaultProjectId: projects[0] ? projects[0].id : null,
          apiPrefix: API_PREFIX,
        });
        return;
      }

      if (segments[0] === 'projects') {
        if (segments.length === 1) {
          if (method === 'GET') {
            sendJson(res, 200, { projects: store.listProjects() });
            return;
          }
          if (method === 'POST') {
            const body = await readJson(req);
            sendJson(res, 201, { project: store.createProject(body) });
            return;
          }
          throw httpError(405, 'Method not allowed');
        }

        const projectId = segments[1];
        if (segments.length === 2) {
          if (method === 'PATCH') {
            const body = await readJson(req);
            sendJson(res, 200, { project: store.updateProject(projectId, body) });
            return;
          }
          throw httpError(405, 'Method not allowed');
        }

        if (segments.length === 4 && segments[2] === 'uploads' && segments[3] === 'init') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 201, { upload: await store.initUpload(projectId, body) });
          return;
        }

        if (segments.length === 3 && segments[2] === 'vector-layers') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          const dataset = await store.createVectorLayer(projectId, body);
          const layer = store.createLayer(projectId, { datasetId: dataset.id, name: body.name || dataset.profile.name });
          sendJson(res, 201, { dataset, layer });
          return;
        }

        if (segments.length === 3 && segments[2] === 'databases') {
          if (method === 'GET') {
            sendJson(res, 200, { databases: store.listDatabases(projectId) });
            return;
          }
          if (method === 'POST') {
            const body = await readJson(req);
            sendJson(res, 201, { database: await store.createDatabase(projectId, body) });
            return;
          }
          throw httpError(405, 'Method not allowed');
        }

        if (segments.length === 3 && segments[2] === 'state') {
          if (method !== 'PUT' && method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 200, {
            layers: store.replaceProjectLayerState(projectId, body),
            project: store.listProjects().find((project) => project.id === projectId),
          });
          return;
        }

        if (segments.length === 3 && segments[2] === 'datasets') {
          if (method === 'GET') {
            sendJson(res, 200, { datasets: store.listDatasets(projectId) });
            return;
          }
          if (method === 'POST') {
            const body = await readJson(req);
            if (body.uri && isTileTemplate(body.uri)) {
              const dataset = store.createTileDataset(projectId, {
                name: body.name,
                tileUrl: body.uri,
                tileSize: body.tileSize,
                attribution: body.attribution,
              });
              const layer = body.addLayer === true && dataset.profile && dataset.profile.renderable !== false
                ? store.createLayer(projectId, { datasetId: dataset.id, name: body.name || undefined })
                : null;
              sendJson(res, 201, { dataset, layer });
              return;
            }
            if (!body.path) throw httpError(400, 'path is required for a file dataset');
            const datasets = await store.createDatasetsFromPath(projectId, body.path, {
              crs: body.crs,
              bbox: body.bbox,
            });
            const layers = [];
            if (body.addLayer === true) {
              for (const dataset of datasets) {
                if (!dataset.profile || dataset.profile.renderable === false) continue;
                layers.push(store.createLayer(projectId, {
                  datasetId: dataset.id,
                  name: datasets.length === 1 ? body.name || undefined : undefined,
                }));
              }
            }
            sendJson(res, 201, {
              datasets,
              layers,
              dataset: datasets[0] || null,
              layer: layers[0] || null,
            });
            return;
          }
          throw httpError(405, 'Method not allowed');
        }

        if (segments.length === 4 && segments[2] === 'datasets' && segments[3] === 'upload') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const { form, file } = await parseUpload(req);
          const fileName = safeUploadName(file.name);
          const storedPath = path.join(store.uploadsDir, `${Date.now()}-${randomUUID()}-${fileName}`);
          await fs.writeFile(storedPath, Buffer.from(await file.arrayBuffer()));
          const datasets = await store.createDatasetsFromPath(projectId, storedPath, {
            crs: form.get('crs'),
            bbox: form.get('bbox'),
            fileName,
          });
          const addLayer = String(form.get('addLayer') || '') === 'true';
          const layers = addLayer
            ? datasets.filter((dataset) => dataset.profile && dataset.profile.renderable !== false)
              .map((dataset) => store.createLayer(projectId, { datasetId: dataset.id }))
            : [];
          sendJson(res, 201, {
            datasets,
            layers,
            dataset: datasets[0] || null,
            layer: layers[0] || null,
          });
          return;
        }

        if (segments.length === 4 && segments[2] === 'datasets' && segments[3] === 'tile') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          const dataset = store.createTileDataset(projectId, body);
          const layer = body.addLayer === false
            ? null
            : store.createLayer(projectId, { datasetId: dataset.id, name: body.name || undefined });
          sendJson(res, 201, { dataset, layer });
          return;
        }

        if (segments.length === 3 && segments[2] === 'layers') {
          if (method === 'GET') {
            sendJson(res, 200, { layers: store.listLayers(projectId) });
            return;
          }
          if (method === 'POST') {
            const body = await readJson(req);
            sendJson(res, 201, { layer: store.createLayer(projectId, body) });
            return;
          }
          throw httpError(405, 'Method not allowed');
        }
      }

      if (segments[0] === 'datasets') {
        const datasetId = segments[1];
        if (segments.length === 2) {
          if (method === 'DELETE') {
            const deleted = await store.deleteDataset(datasetId);
            if (!deleted) throw httpError(404, 'Dataset not found');
            sendNoContent(res);
            return;
          }
          throw httpError(405, 'Method not allowed');
        }
        if (segments.length === 3 && segments[2] === 'convert') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 200, { dataset: await store.convertDatasetToCog(datasetId, { force: body.force === true }) });
          return;
        }

        if (segments.length === 6 && segments[2] === 'tiles') {
          if (method !== 'GET' && method !== 'HEAD') throw httpError(405, 'Method not allowed');
          const tile = await store.tileInfo(datasetId, segments[3], segments[4], segments[5].replace(/\.png$/i, ''));
          res.writeHead(200, {
            'content-type': 'image/png',
            'content-length': tile.size,
            'cache-control': 'public, max-age=3600',
          });
          if (method === 'HEAD') {
            res.end();
            return;
          }
          store.createReadStream(tile.filePath).pipe(res);
          return;
        }

        if (segments.length === 4 && segments[2] === 'features' && segments[3] === 'update') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 200, { dataset: await store.updateVectorFeature(datasetId, body) });
          return;
        }

        if (segments.length === 4 && segments[2] === 'features' && segments[3] === 'delete') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 200, { dataset: await store.deleteVectorFeature(datasetId, body) });
          return;
        }

        if (segments.length === 3 && segments[2] === 'features') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 201, { dataset: await store.addVectorFeature(datasetId, body) });
          return;
        }

        if (segments.length === 3 && segments[2] === 'content') {
          if (method !== 'GET' && method !== 'HEAD') throw httpError(405, 'Method not allowed');
          const info = await store.contentInfo(datasetId);
          res.writeHead(200, {
            'content-type': info.mime,
            'content-length': info.size,
            'cache-control': 'no-store',
          });
          if (method === 'HEAD') {
            res.end();
            return;
          }
          const stream = store.createReadStream(info.filePath);
          stream.on('error', (error) => {
            console.error('[gis-workbench] dataset stream failed', error);
            res.destroy(error);
          });
          stream.pipe(res);
          return;
        }
      }

      if (segments[0] === 'layers' && segments.length === 2) {
        const layerId = segments[1];
        if (method === 'PATCH') {
          const body = await readJson(req);
          sendJson(res, 200, { layer: store.updateLayer(layerId, body) });
          return;
        }
        if (method === 'DELETE') {
          const deleted = store.deleteLayer(layerId);
          if (!deleted) throw httpError(404, 'Layer not found');
          sendNoContent(res);
          return;
        }
        throw httpError(405, 'Method not allowed');
      }

      if (segments[0] === 'uploads') {
        const uploadId = segments[1];
        if (!uploadId) throw httpError(404, 'Not found');
        if (segments.length === 2) {
          if (method === 'GET') {
            sendJson(res, 200, { upload: store.getUpload(uploadId) });
            return;
          }
          if (method === 'DELETE') {
            await store.deleteUpload(uploadId);
            sendNoContent(res);
            return;
          }
          throw httpError(405, 'Method not allowed');
        }
        if (segments.length === 4 && segments[2] === 'chunks') {
          if (method !== 'PUT' && method !== 'POST') throw httpError(405, 'Method not allowed');
          const index = Number(segments[3]);
          const buffer = await readBody(req, MAX_CHUNK_BYTES);
          sendJson(res, 200, { upload: await store.writeUploadChunk(uploadId, index, buffer) });
          return;
        }
        if (segments.length === 3 && segments[2] === 'complete') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          sendJson(res, 200, await store.completeUpload(uploadId, body));
          return;
        }
      }

      if (segments[0] === 'glyphs' && segments.length === 3) {
        if (method !== 'GET' && method !== 'HEAD') throw httpError(405, 'Method not allowed');
        const range = segments[2].replace(/\.pbf$/i, '');
        if (!/^\d+-\d+$/.test(range)) throw httpError(400, 'Invalid glyph range');
        const glyphPath = path.join(GLYPH_DIR, range + '.pbf');
        const stat = await fs.stat(glyphPath).catch(() => undefined);
        if (!stat || !stat.isFile()) {
          res.writeHead(404, { 'cache-control': 'no-store' });
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-type': 'application/x-protobuf',
          'content-length': stat.size,
          'cache-control': 'public, max-age=86400',
        });
        if (method === 'HEAD') {
          res.end();
          return;
        }
        store.createReadStream(glyphPath).pipe(res);
        return;
      }

      if (segments[0] === 'databases') {
        const databaseId = segments[1];
        if (!databaseId) throw httpError(404, 'Not found');
        if (segments.length === 2) {
          if (method === 'DELETE') {
            const deleted = store.deleteDatabase(databaseId);
            if (!deleted) throw httpError(404, 'Database registration not found');
            sendNoContent(res);
            return;
          }
          throw httpError(405, 'Method not allowed');
        }
        if (segments.length === 3 && segments[2] === 'tables') {
          if (method !== 'GET') throw httpError(405, 'Method not allowed');
          sendJson(res, 200, { tables: await store.listDatabaseTables(databaseId) });
          return;
        }
        if (segments.length === 4 && segments[2] === 'tables' && segments[3] === 'import') {
          if (method !== 'POST') throw httpError(405, 'Method not allowed');
          const body = await readJson(req);
          const dataset = await store.importPostgisTable(databaseId, body);
          const layer = body.addLayer !== false && dataset.profile && dataset.profile.renderable !== false
            ? store.createLayer(dataset.projectId, { datasetId: dataset.id, name: body.name || dataset.profile.layerName })
            : null;
          sendJson(res, 201, { dataset, layer });
          return;
        }
      }

      if (segments[0] === 'browse' && segments.length === 1) {
        if (method !== 'GET') throw httpError(405, 'Method not allowed');
        sendJson(res, 200, await store.browse(url.searchParams.get('path') || undefined));
        return;
      }

      throw httpError(404, 'Not found');
    } catch (error) {
      const status = Number(error && error.status) || 500;
      if (status >= 500) console.error('[gis-workbench] API error', error);
      if (res.headersSent) {
        res.destroy(error);
        return;
      }
      sendJson(res, status, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}