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

function applyProjectTombstones(projects, removedIds) {
  const drop = new Set((removedIds || []).map((x) => String(x)));
  if (!drop.size) return projects || [];
  return (projects || []).filter((p) => p?.id != null && !drop.has(String(p.id)));
}

/** Merge projects; when allowProjectRemoval, incoming catalog + tombstones win over server union. */
export function mergePreconstructionClientState(serverState, localState, opts = {}) {
  const allowProjectRemoval = !!opts.allowProjectRemoval;
  const ex = serverState && typeof serverState === 'object' ? serverState : {};
  const inc = localState && typeof localState === 'object' ? localState : {};
  const exProjects = ex.projects || [];
  const inProjects = inc.projects || [];

  let removedIds = normalizeRemovedIds(ex, inc);
  if (allowProjectRemoval) {
    const inIds = new Set(inProjects.map((p) => String(p?.id)).filter(Boolean));
    for (const p of exProjects) {
      if (p?.id == null) continue;
      const id = String(p.id);
      if (!inIds.has(id)) removedIds.push(id);
    }
    removedIds = [...new Set(removedIds)];
  }

  const byId = new Map();
  if (allowProjectRemoval) {
    for (const p of inProjects) {
      if (p?.id == null) continue;
      const id = String(p.id);
      const exRow = exProjects.find((x) => String(x?.id) === id);
      byId.set(id, exRow ? mergeProjectDeep(exRow, p) : p);
    }
  } else {
    for (const p of exProjects) {
      if (p?.id != null) byId.set(String(p.id), p);
    }
    for (const p of inProjects) {
      if (p?.id == null) continue;
      const id = String(p.id);
      byId.set(id, byId.has(id) ? mergeProjectDeep(byId.get(id), p) : p);
    }
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
