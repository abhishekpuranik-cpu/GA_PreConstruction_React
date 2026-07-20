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
 * Never infer deletes from a missing project in the local catalog (prevents admin autosave wipe).
 * Deletes only via explicit `_removedProjectIds`.
 */
export function mergePreconstructionClientState(serverState, localState, opts = {}) {
  void opts;
  const ex = serverState && typeof serverState === 'object' ? serverState : {};
  const inc = localState && typeof localState === 'object' ? localState : {};
  const exProjects = ex.projects || [];
  const inProjects = inc.projects || [];

  const removedIds = normalizeRemovedIds(ex, inc);

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
    _removedProjectIds: removedIds,
    projects: [...byId.values()],
  };
}
