/**
 * Flat task list + parentId adjacency (same phase).
 * `par` remains schedule parallel-to — do not reuse for hierarchy.
 */

export function taskParentId(t) {
  const p = t?.parentId;
  if (p == null || p === '') return null;
  return String(p);
}

export function taskDepth(t, byId, seen = new Set()) {
  const pid = taskParentId(t);
  if (!pid) return 0;
  if (seen.has(t.id)) return 0;
  seen.add(t.id);
  const parent = byId.get(pid);
  if (!parent) return 0;
  return 1 + taskDepth(parent, byId, seen);
}

export function indexTasksById(tasks) {
  const m = new Map();
  (tasks || []).forEach((t) => {
    if (t?.id) m.set(String(t.id), t);
  });
  return m;
}

/** Direct children in list order. */
export function directChildren(tasks, parentId) {
  const pid = parentId == null || parentId === '' ? null : String(parentId);
  return (tasks || []).filter((t) => taskParentId(t) === pid);
}

/** All descendant ids (not including root). */
export function collectDescendantIds(tasks, rootId) {
  const rid = String(rootId || '');
  if (!rid) return [];
  const out = [];
  const stack = [rid];
  const seen = new Set([rid]);
  while (stack.length) {
    const cur = stack.pop();
    (tasks || []).forEach((t) => {
      if (taskParentId(t) !== cur) return;
      const id = String(t.id);
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
      stack.push(id);
    });
  }
  return out;
}

/** Subtree = root + descendants, preserving relative list order. */
export function extractSubtree(tasks, rootId) {
  const rid = String(rootId || '');
  const ids = new Set([rid, ...collectDescendantIds(tasks, rid)]);
  return (tasks || []).filter((t) => ids.has(String(t.id)));
}

/** Index after last descendant of parent (or after parent if none). */
export function insertIndexAfterParent(tasks, parentId) {
  const list = tasks || [];
  const pid = String(parentId || '');
  const pIdx = list.findIndex((t) => String(t.id) === pid);
  if (pIdx < 0) return list.length;
  const desc = new Set(collectDescendantIds(list, pid));
  let last = pIdx;
  for (let i = pIdx + 1; i < list.length; i++) {
    if (desc.has(String(list[i].id))) last = i;
    else break;
  }
  return last + 1;
}

/**
 * Depth-first order for display: roots in list order, then their children, etc.
 * Orphans (parent missing) treated as roots.
 */
export function orderTasksAsTree(tasks) {
  const list = Array.isArray(tasks) ? tasks.slice() : [];
  if (!list.length) return [];
  const byId = indexTasksById(list);
  const children = new Map();
  list.forEach((t) => {
    const pid = taskParentId(t);
    const key = pid && byId.has(pid) ? pid : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(t);
  });
  const out = [];
  const walk = (pid) => {
    (children.get(pid) || []).forEach((t) => {
      out.push(t);
      walk(String(t.id));
    });
  };
  walk(null);
  return out;
}

export function annotateTreeMeta(tasks) {
  const ordered = orderTasksAsTree(tasks);
  const byId = indexTasksById(ordered);
  const childCount = new Map();
  ordered.forEach((t) => {
    const pid = taskParentId(t);
    if (pid && byId.has(pid)) childCount.set(pid, (childCount.get(pid) || 0) + 1);
  });
  return ordered.map((t) => ({
    task: t,
    depth: taskDepth(t, byId),
    hasChildren: (childCount.get(String(t.id)) || 0) > 0,
    parentId: taskParentId(t),
  }));
}

/** Cascade delete: root + all descendants. */
export function idsToDeleteWithDescendants(tasks, rootId) {
  return [String(rootId), ...collectDescendantIds(tasks, rootId)];
}

/** Move subtree of fromId so it sits before/at toId position (sibling-aware simple move). */
export function reorderSubtree(tasks, fromId, toId) {
  const list = (tasks || []).slice();
  const from = String(fromId);
  const to = String(toId);
  if (from === to) return list;
  const subtree = extractSubtree(list, from);
  if (!subtree.length) return list;
  const subIds = new Set(subtree.map((t) => String(t.id)));
  if (subIds.has(to)) return list; // cannot move into own descendant
  const rest = list.filter((t) => !subIds.has(String(t.id)));
  const toIdx = rest.findIndex((t) => String(t.id) === to);
  if (toIdx < 0) return list;
  return [...rest.slice(0, toIdx), ...subtree, ...rest.slice(toIdx)];
}

export function normalizeParentIdOnTask(t) {
  if (!t || typeof t !== 'object') return t;
  if (t.parentId == null || t.parentId === '') {
    if ('parentId' in t) t.parentId = null;
    return t;
  }
  t.parentId = String(t.parentId);
  return t;
}
