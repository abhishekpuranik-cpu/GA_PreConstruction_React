import {
  ensureCommentCreatedAt,
  legacyTaskCommentSources,
  mergeCommentBuckets,
  normalizeTaskComments,
  normTaskKey,
} from './preconComments.js';

function taskNameKeys(name) {
  const keys = new Set();
  const raw = String(name || '').trim();
  const base = normTaskKey(raw);
  if (base) keys.add(base);
  const stripped = normTaskKey(raw.replace(/^[^:]+:\s*/, ''));
  if (stripped) keys.add(stripped);
  return [...keys];
}

function commentsFingerprint(comments) {
  try {
    return JSON.stringify(normalizeTaskComments(comments));
  } catch {
    return '';
  }
}

function applyComments(task, merged) {
  const withTs = merged.map((c) => ensureCommentCreatedAt(c));
  const next = commentsFingerprint(withTs);
  const prev = commentsFingerprint(task.comments);
  if (next !== prev) {
    task.comments = withTs;
    return true;
  }
  return false;
}

/**
 * Repair every task's comments on each workspace load:
 * - normalize legacy shapes (strings, objects, remark fields)
 * - merge comments across same-named tasks (even in different phases)
 * - write the merged list back onto every matching task
 */
export function repairAllTaskComments(state) {
  if (!state || typeof state !== 'object') return { state, changed: false, groups: 0 };

  let changed = false;
  let groups = 0;

  for (const proj of state.projects || []) {
    const hits = [];
    for (const ph of proj.phases || []) {
      for (const task of ph.tasks || []) {
        hits.push({ ph, task, keys: taskNameKeys(task.name) });
      }
    }

    const parent = new Map();
    const find = (id) => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root);
      let cur = id;
      while (cur !== root) {
        const next = parent.get(cur);
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };

    hits.forEach(({ task, ph }, index) => {
      const id = `${index}`;
      parent.set(id, id);
    });

    const keyOwner = new Map();
    hits.forEach(({ keys }, index) => {
      const id = `${index}`;
      keys.forEach((key) => {
        if (!key) return;
        if (keyOwner.has(key)) union(id, keyOwner.get(key));
        else keyOwner.set(key, id);
      });
    });

    const clusters = new Map();
    hits.forEach((hit, index) => {
      const root = find(`${index}`);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(hit);
    });

    clusters.forEach((cluster) => {
      if (cluster.length > 1) groups += 1;
      const merged = mergeCommentBuckets(cluster.flatMap(({ task }) => legacyTaskCommentSources(task)));
      cluster.forEach(({ task }) => {
        if (applyComments(task, merged.length ? merged : normalizeTaskComments(task.comments))) {
          changed = true;
        }
      });
    });
  }

  return { state, changed, groups };
}

/** @deprecated use repairAllTaskComments */
export function reconcileDuplicateTaskComments(state) {
  return repairAllTaskComments(state);
}
