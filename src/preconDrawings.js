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

export async function uploadDrawings(meta, files) {
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
  const res = await fetch('/api/preconstruction/attachments', {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  return jsonOrError(res);
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
