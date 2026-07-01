import { collectTaskComments, mergeCommentBuckets, normalizeTaskComments } from './preconComments.js';

export const COMMENT_RECONCILE_VERSION = 1;

function normTaskKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function taskRichness(task) {
  let score = 0;
  if (task?.ae) score += 8;
  if (task?.as) score += 4;
  if (task?.ms) score += 2;
  if (task?.status && task.status !== 'notstarted') score += 2;
  score += normalizeTaskComments(task?.comments).length;
  if (task?.who) score += 1;
  return score;
}

function pickPrimaryTask(tasks) {
  if (!tasks?.length) return null;
  return tasks.reduce((best, task) => (taskRichness(task) > taskRichness(best) ? task : best), tasks[0]);
}

/** Copy merged comments onto the richest duplicate task in each name group. */
export function reconcileDuplicateTaskComments(state) {
  if (!state || typeof state !== 'object') return { state, changed: false, groups: 0 };
  if ((state.commentReconcileVersion || 0) >= COMMENT_RECONCILE_VERSION) {
    return { state, changed: false, groups: 0 };
  }

  let changed = false;
  let groups = 0;

  for (const proj of state.projects || []) {
    const byName = new Map();
    for (const ph of proj.phases || []) {
      for (const task of ph.tasks || []) {
        const key = normTaskKey(task.name);
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push({ ph, task });
      }
    }

    byName.forEach((hits) => {
      if (hits.length < 2) return;
      groups += 1;
      const primary = pickPrimaryTask(hits.map((h) => h.task));
      const primaryHit = hits.find((h) => h.task.id === primary.id) || hits[0];
      const merged = mergeCommentBuckets(hits.map((h) => collectTaskComments(proj, h.ph, h.task, { includeAliases: false })));
      const current = normalizeTaskComments(primaryHit.task.comments);
      if (merged.length > current.length) {
        primaryHit.task.comments = merged;
        changed = true;
      }
    });
  }

  state.commentReconcileVersion = COMMENT_RECONCILE_VERSION;
  return { state, changed, groups };
}
