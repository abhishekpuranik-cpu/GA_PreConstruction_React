/** Client-side PreConstruction workspace merge (409 recovery + team sync). */
import { mergeActivityLogs } from './preconActivityLog.js';
import { mergeProjectDeep } from './preconProjectMerge.js';

function normalizeRemovedIds(...sources) {
  const out = new Set();
  for (const src of sources) {
    if (!src || typeof src !== 'object') continue;
    const list = Array.isArray(src._removedProjectIds) ? src._removedProjectIds : [];
    for (const id of list) {
      const s = String(id || '').trim();
      if (s) out.add(s);
    }
  }
  return [...out];
}

/**
 * Merge server + local workspace.
 * Ignores mass tombstone lists from poisoned local state (same rules as server).
 */
export function mergePreconstructionClientState(serverState, localState, opts = {}) {
  void opts;
  const ex = serverState && typeof serverState === 'object' ? serverState : {};
  const inc = localState && typeof localState === 'object' ? localState : {};
  const exProjects = ex.projects || [];
  const inProjects = inc.projects || [];

  const exRemoved = new Set(normalizeRemovedIds(ex));
  const incRemoved = normalizeRemovedIds(inc);
  const inIds = new Set(inProjects.map((p) => String(p?.id)).filter(Boolean));

  const removedIds = new Set(exRemoved);
  for (const id of inIds) removedIds.delete(id);

  const newDeletes = incRemoved.filter((id) => !inIds.has(id) && !exRemoved.has(id));
  const MAX_NEW_DELETES_PER_SAVE = 2;
  if (newDeletes.length > 0 && newDeletes.length <= MAX_NEW_DELETES_PER_SAVE) {
    for (const id of newDeletes) removedIds.add(id);
  }

  const byId = new Map();
  for (const p of exProjects) {
    if (p?.id != null) byId.set(String(p.id), p);
  }
  for (const p of inProjects) {
    if (p?.id == null) continue;
    const id = String(p.id);
    byId.set(id, byId.has(id) ? mergeProjectDeep(byId.get(id), p) : p);
  }

  for (const id of removedIds) byId.delete(id);

  return {
    cloudUrl: inc.cloudUrl != null && String(inc.cloudUrl).trim() ? inc.cloudUrl : ex.cloudUrl || '',
    departments:
      Array.isArray(inc.departments) && inc.departments.length ? inc.departments : ex.departments || [],
    activityLog: mergeActivityLogs(ex.activityLog, inc.activityLog),
    _removedProjectIds: [...removedIds],
    projects: [...byId.values()],
  };
}
