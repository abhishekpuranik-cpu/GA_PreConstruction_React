export const DRAWING_TYPES = [
  'Architectural',
  'Structural',
  'MEP',
  'Electrical',
  'Plumbing',
  'Fire & Life Safety',
  'Landscape',
  'Interior',
  'Authority Submission',
  'As-built',
  'Other',
];

export const DRAWING_SCOPE_TYPES = [
  { id: 'project', label: 'Project level' },
  { id: 'phase', label: 'Phase level' },
  { id: 'building', label: 'Building level' },
  { id: 'amenity', label: 'Common Amenities' },
];

async function jsonOrError(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

const vaultCache = new Map();

export function getCachedDrawingVault(projectId = '', { archived = false } = {}) {
  return vaultCache.get(`${projectId}:${archived ? 'archive' : 'active'}`) || null;
}

export function invalidateDrawingVaultCache(projectId = '') {
  for (const key of vaultCache.keys()) {
    if (!projectId || key.startsWith(`${projectId}:`)) vaultCache.delete(key);
  }
}

export async function fetchDrawingVault(projectId = '', { archived = false, signal } = {}) {
  const q = new URLSearchParams();
  if (projectId) q.set('projectId', projectId);
  if (archived) q.set('view', 'archive');
  const suffix = q.toString() ? `?${q}` : '';
  const res = await fetch(`/api/preconstruction/drawing-vault${suffix}`, {
    credentials: 'include',
    cache: 'no-cache',
    signal,
  });
  const data = await jsonOrError(res);
  vaultCache.set(`${projectId}:${archived ? 'archive' : 'active'}`, data);
  return data;
}

export async function listDrawings(projectId = '', { archived = false } = {}) {
  const q = new URLSearchParams();
  if (projectId) q.set('projectId', projectId);
  if (archived) q.set('view', 'archive');
  const suffix = q.toString() ? `?${q}` : '';
  const res = await fetch(`/api/preconstruction/drawings${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await jsonOrError(res);
  return data.drawings || [];
}

export async function fetchDrawingCatalog() {
  const res = await fetch('/api/preconstruction/drawing-catalog', {
    credentials: 'include',
    cache: 'no-store',
  });
  return jsonOrError(res);
}

export async function addDrawingCatalogItem(item) {
  const res = await fetch('/api/preconstruction/drawing-catalog', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  return jsonOrError(res);
}

export async function updateDrawingCatalogItem(id, patch) {
  const res = await fetch(`/api/preconstruction/drawing-catalog/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrError(res);
}

export async function deleteDrawingCatalogItem(id) {
  const res = await fetch(`/api/preconstruction/drawing-catalog/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return jsonOrError(res);
}

export async function fetchDrawingPlan(projectId) {
  if (!projectId) return [];
  const res = await fetch(
    `/api/preconstruction/drawing-plan?projectId=${encodeURIComponent(projectId)}`,
    { credentials: 'include', cache: 'no-store' }
  );
  const data = await jsonOrError(res);
  return data.plans || [];
}

export async function saveDrawingPlan(catalogItemId, plan) {
  const res = await fetch(
    `/api/preconstruction/drawing-plan/${encodeURIComponent(catalogItemId)}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    }
  );
  const data = await jsonOrError(res);
  return data.plan;
}

export async function uploadDrawings(meta, files, onProgress) {
  const fd = new FormData();
  Object.entries({
    projectId: meta.projectId,
    projectPhase: meta.projectPhase,
    building: meta.building,
    commonAmenity: meta.commonAmenity,
    scopeType: meta.scopeType,
    scopeKey: meta.scopeKey,
    scopeLabel: meta.scopeLabel,
    catalogItemId: meta.catalogItemId,
    stage: meta.stage,
    source: meta.source,
    drawingName: meta.drawingName,
    plannedStart: meta.plannedStart,
    plannedEnd: meta.plannedEnd,
    drawingType: meta.drawingType,
    subDrawing: meta.subDrawing,
    parentDrawingId: meta.parentDrawingId,
    revision: meta.revision,
    status: meta.status,
    description: meta.description,
    scope: 'drawing',
  }).forEach(([key, value]) => fd.append(key, value || ''));
  fd.append(
    'labels',
    JSON.stringify((files || []).map((file) => meta.label || file.name))
  );
  (files || []).forEach((file) => fd.append('files', file));
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/preconstruction/attachments');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== 'function') return;
      onProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading drawing'));
    xhr.onabort = () => reject(new Error('Drawing upload cancelled'));
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error || `Upload failed (${xhr.status})`));
        return;
      }
      onProgress?.(100);
      resolve(data);
    };
    xhr.send(fd);
  });
}

export async function updateDrawing(id, patch) {
  const res = await fetch(`/api/preconstruction/drawings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return jsonOrError(res);
}

export async function archiveDrawing(id) {
  const res = await fetch(`/api/preconstruction/drawings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return jsonOrError(res);
}

export async function restoreDrawing(id) {
  const res = await fetch(`/api/preconstruction/drawings/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    credentials: 'include',
  });
  return jsonOrError(res);
}

export async function decideDrawing(id, decision, note = '') {
  const res = await fetch(`/api/preconstruction/drawings/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, note }),
  });
  return jsonOrError(res);
}
