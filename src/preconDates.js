/** Date engine extracted for export + status (mirrors App.jsx cDates). */

import { directChildren, indexTasksById, orderTasksAsTree, taskDepth, taskParentId } from './preconTaskTree.js';

const aD = (d, n) => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

const iso = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

export function dbDays(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}

/**
 * Parents with subtasks inherit:
 * start = start of first child (tree order), end = end of last child.
 * Nested parents are resolved deepest-first.
 */
export function applyParentDateRollups(map, tasks) {
  if (!map || !tasks?.length) return map;
  const ordered = orderTasksAsTree(tasks);
  const byId = indexTasksById(ordered);
  const parents = [];
  ordered.forEach((t) => {
    const kids = directChildren(ordered, t.id);
    if (kids.length) parents.push({ id: String(t.id), kids, depth: taskDepth(t, byId) });
  });
  parents.sort((a, b) => b.depth - a.depth);
  parents.forEach(({ id, kids }) => {
    const first = kids[0];
    const last = kids[kids.length - 1];
    const s = map[first?.id]?.s;
    const e = map[last?.id]?.e;
    if (!s || !e) return;
    map[id] = { s, e, rolledUp: true };
  });
  return map;
}

/** Span in days inclusive (for rolled-up parents). */
export function dateSpanDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  return Math.max(1, dbDays(startIso, endIso) + 1);
}

export function cDates(proj) {
  const all = [];
  (proj.phases || []).forEach((ph) => (ph.tasks || []).forEach((t) => all.push(t)));
  const map = {};
  const ko = new Date(proj.ko);
  for (const t of all) {
    let s;
    if (t.ms) s = new Date(t.ms);
    else if (t.offsetFromKo != null && t.offsetFromKo !== '' && !Number.isNaN(Number(t.offsetFromKo))) {
      s = aD(ko, Number(t.offsetFromKo));
    } else if (t.par && map[t.par]) s = new Date(map[t.par].s);
    else if (t.pred?.length) {
      let mx = new Date(ko);
      t.pred.forEach((p) => {
        if (map[p]) {
          const e = new Date(map[p].e);
          if (e > mx) mx = e;
        }
      });
      s = aD(mx, 1);
    } else s = new Date(ko);
    map[t.id] = { s: iso(s), e: iso(aD(s, Math.max(t.dur - 1, 0))) };
  }
  (proj.phases || []).forEach((ph) => applyParentDateRollups(map, ph.tasks || []));
  return map;
}

/** True when any ancestor is collapsed (expandedMap[id] === false). Missing key = expanded. */
export function isHiddenByCollapsedAncestor(task, byId, expandedMap) {
  let pid = taskParentId(task);
  const seen = new Set();
  while (pid) {
    if (seen.has(pid)) break;
    seen.add(pid);
    if (expandedMap && expandedMap[pid] === false) return true;
    const parent = byId?.get(pid);
    if (!parent) break;
    pid = taskParentId(parent);
  }
  return false;
}
