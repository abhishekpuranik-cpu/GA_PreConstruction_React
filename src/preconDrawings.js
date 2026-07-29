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

async function jsonOrError(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function listDrawings(projectId = '') {
  const q = new URLSearchParams();
  if (projectId) q.set('projectId', projectId);
  const suffix = q.toString() ? `?${q}` : '';
  const res = await fetch(`/api/preconstruction/drawings${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await jsonOrError(res);
  return data.drawings || [];
}

export async function uploadDrawings(meta, files) {
  const fd = new FormData();
  Object.entries({
    projectId: meta.projectId,
    phaseId: meta.phaseId,
    phaseName: meta.phaseName,
    building: meta.building,
    drawingType: meta.drawingType,
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
