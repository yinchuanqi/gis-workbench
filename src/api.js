const BASE = '/api/gis-workbench';

async function request(path, options = {}) {
  const init = {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: { ...(options.headers || {}) },
  };
  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      init.body = options.body;
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
  }
  const response = await fetch(BASE + path, init);
  const type = response.headers.get('content-type') || '';
  let payload = null;
  if (type.includes('application/json')) {
    payload = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    payload = text ? { error: text } : null;
  }
  if (!response.ok) {
    const error = new Error((payload && payload.error) || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function query(path, params) {
  const url = new URL(path, 'http://local');
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return url.pathname + (url.search || '');
}

export function getBootstrap() {
  return request('');
}

export function listProjects() {
  return request('/projects').then((value) => value.projects || []);
}

export function createProject(input) {
  return request('/projects', { method: 'POST', body: input }).then((value) => value.project);
}

export function updateProject(id, input) {
  return request('/projects/' + encodeURIComponent(id), { method: 'PATCH', body: input }).then((value) => value.project);
}

export function saveProjectState(projectId, state) {
  return request('/projects/' + encodeURIComponent(projectId) + '/state', {
    method: 'PUT',
    body: state,
  });
}

export function listDatasets(projectId) {
  return request('/projects/' + encodeURIComponent(projectId) + '/datasets').then((value) => value.datasets || []);
}

export function createDataset(projectId, input) {
  return request('/projects/' + encodeURIComponent(projectId) + '/datasets', {
    method: 'POST',
    body: input,
  });
}

export function createTileDataset(projectId, input) {
  return request('/projects/' + encodeURIComponent(projectId) + '/datasets/tile', {
    method: 'POST',
    body: input,
  });
}

export function uploadDataset(projectId, file, options = {}) {
  const form = new FormData();
  form.set('file', file, file.name);
  if (options.crs !== undefined && options.crs !== null && options.crs !== '') form.set('crs', String(options.crs));
  if (options.bbox !== undefined && options.bbox !== null && options.bbox !== '') {
    form.set('bbox', typeof options.bbox === 'string' ? options.bbox : JSON.stringify(options.bbox));
  }
  if (options.addLayer) form.set('addLayer', 'true');
  return request('/projects/' + encodeURIComponent(projectId) + '/datasets/upload', {
    method: 'POST',
    body: form,
  });
}

export function convertDataset(id, options = {}) {
  return request('/datasets/' + encodeURIComponent(id) + '/convert', {
    method: 'POST',
    body: { force: options.force === true },
  }).then((value) => value.dataset);
}

export function deleteDataset(id) {
  return request('/datasets/' + encodeURIComponent(id), { method: 'DELETE' });
}

export function listLayers(projectId) {
  return request('/projects/' + encodeURIComponent(projectId) + '/layers').then((value) => value.layers || []);
}

export function createLayer(projectId, input) {
  return request('/projects/' + encodeURIComponent(projectId) + '/layers', {
    method: 'POST',
    body: input,
  }).then((value) => value.layer);
}

export function updateLayer(id, input) {
  return request('/layers/' + encodeURIComponent(id), {
    method: 'PATCH',
    body: input,
  }).then((value) => value.layer);
}

export function deleteLayer(id) {
  return request('/layers/' + encodeURIComponent(id), { method: 'DELETE' });
}

export function browse(pathname) {
  return request(query('/browse', { path: pathname }));
}

export function contentUrl(datasetId) {
  return BASE + '/datasets/' + encodeURIComponent(datasetId) + '/content';
}

export function initUpload(projectId, input) {
  return request('/projects/' + encodeURIComponent(projectId) + '/uploads/init', {
    method: 'POST',
    body: input,
  }).then((value) => value.upload);
}

export function getUpload(uploadId) {
  return request('/uploads/' + encodeURIComponent(uploadId)).then((value) => value.upload);
}

export function deleteUpload(uploadId) {
  return request('/uploads/' + encodeURIComponent(uploadId), { method: 'DELETE' });
}

export function completeUpload(uploadId, input = {}) {
  return request('/uploads/' + encodeURIComponent(uploadId) + '/complete', {
    method: 'POST',
    body: input,
  });
}

export function uploadChunk(uploadId, index, blob, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const done = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onAbort = () => {
      try {
        xhr.abort();
      } catch (error) {
        // The request may already be settled.
      }
      const error = new Error('Upload aborted');
      error.name = 'AbortError';
      fail(error);
    };
    xhr.open('PUT', BASE + '/uploads/' + encodeURIComponent(uploadId) + '/chunks/' + index);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) onProgress(event.loaded);
    };
    xhr.onload = () => {
      let payload = null;
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch (error) {
        payload = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) done(payload && payload.upload ? payload.upload : payload);
      else fail(new Error((payload && payload.error) || `Chunk upload failed (${xhr.status})`));
    };
    xhr.onerror = () => fail(new Error('Network error while uploading chunk'));
    xhr.ontimeout = () => fail(new Error('Chunk upload timed out'));
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    xhr.send(blob);
  });
}

export function listDatabases(projectId) {
  return request('/projects/' + encodeURIComponent(projectId) + '/databases').then((value) => value.databases || []);
}

export function createDatabase(projectId, input) {
  return request('/projects/' + encodeURIComponent(projectId) + '/databases', {
    method: 'POST',
    body: input,
  }).then((value) => value.database);
}

export function deleteDatabase(databaseId) {
  return request('/databases/' + encodeURIComponent(databaseId), { method: 'DELETE' });
}

export function listDatabaseTables(databaseId) {
  return request('/databases/' + encodeURIComponent(databaseId) + '/tables').then((value) => value.tables || []);
}

export function importDatabaseTable(databaseId, input) {
  return request('/databases/' + encodeURIComponent(databaseId) + '/tables/import', {
    method: 'POST',
    body: input,
  });
}

export function createVectorLayer(projectId, input) {
  return request('/projects/' + encodeURIComponent(projectId) + '/vector-layers', {
    method: 'POST',
    body: input,
  });
}

export function addVectorFeature(datasetId, input) {
  return request('/datasets/' + encodeURIComponent(datasetId) + '/features', {
    method: 'POST',
    body: input,
  }).then((value) => value.dataset);
}

export function deleteVectorFeature(datasetId, input) {
  return request('/datasets/' + encodeURIComponent(datasetId) + '/features/delete', {
    method: 'POST',
    body: input,
  }).then((value) => value.dataset);
}

export function updateVectorFeature(datasetId, input) {
  return request('/datasets/' + encodeURIComponent(datasetId) + '/features/update', {
    method: 'POST',
    body: input,
  }).then((value) => value.dataset);
}
