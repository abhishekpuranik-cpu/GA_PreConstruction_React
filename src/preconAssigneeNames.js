import { expandAssigneeTokens, formatAssignees } from './preconAssignees.js';

/** Known alias → canonical display name (keys are normalized). */
export const ASSIGNEE_CANONICAL = {
  amit: 'Amit Dhumal',
  'amit dhumal': 'Amit Dhumal',
  'amit dhumal (amit)': 'Amit Dhumal',
  'amar shah': 'Amar Shah',
  'amar shah (amar)': 'Amar Shah',
  'amar shah ( amar)': 'Amar Shah',
  ashish: 'Ashish Chaudhari',
  'ashish chaudhari': 'Ashish Chaudhari',
  'ashish chaudhari (ashish)': 'Ashish Chaudhari',
  minal: 'Minal Firake',
  'minal madam': 'Minal Firake',
  'minal firake': 'Minal Firake',
  'minal firake (minal)': 'Minal Firake',
  'minal firake ( minal)': 'Minal Firake',
  'minal firke': 'Minal Firake',
  'minal firke (minal)': 'Minal Firake',
  'minal firke ( minal)': 'Minal Firake',
};

export function normAssigneeKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Remove trailing parenthetical nicknames, then map aliases to full names. */
export function canonicalAssigneeName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';

  const direct = ASSIGNEE_CANONICAL[normAssigneeKey(raw)];
  if (direct) return direct;

  const withoutParen = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (withoutParen && withoutParen !== raw) {
    const fromBase = ASSIGNEE_CANONICAL[normAssigneeKey(withoutParen)];
    if (fromBase) return fromBase;
    return withoutParen;
  }

  const fromShort = ASSIGNEE_CANONICAL[normAssigneeKey(raw)];
  return fromShort || raw;
}

export function canonicalizeWho(who) {
  const names = expandAssigneeTokens(who)
    .map(canonicalAssigneeName)
    .filter(Boolean);
  return formatAssignees(names);
}

function normTaskName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function commentKey(c) {
  const a = String(c?.author || '').trim();
  const t = String(c?.text || '').trim();
  const ts = String(c?.createdAt || c?.ts || '').trim();
  return `${a}|${t}|${ts}`;
}

function mergeComments(a = [], b = []) {
  const seen = new Set();
  const out = [];
  [...a, ...b].forEach((c) => {
    if (!c) return;
    const k = commentKey(c);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  });
  return out;
}

function pickRicherTask(a, b) {
  const score = (t) => {
    let s = 0;
    if (t.ae) s += 8;
    if (t.as) s += 4;
    if (t.ms) s += 2;
    if (t.status && t.status !== 'notstarted') s += 2;
    s += (t.comments || []).length;
    if (t.who) s += 1;
    return s;
  };
  return score(b) > score(a) ? b : a;
}

function mergeTaskPair(keep, drop) {
  const merged = { ...keep };
  merged.who = canonicalizeWho([keep.who, drop.who].filter(Boolean).join('; '));
  merged.comments = mergeComments(keep.comments, drop.comments);
  if (!merged.as && drop.as) merged.as = drop.as;
  if (!merged.ae && drop.ae) merged.ae = drop.ae;
  if (!merged.ms && drop.ms) merged.ms = drop.ms;
  if (!merged.plannedEnd && drop.plannedEnd) merged.plannedEnd = drop.plannedEnd;
  if ((!merged.status || merged.status === 'notstarted') && drop.status && drop.status !== 'notstarted') {
    merged.status = drop.status;
  }
  if ((!merged.dur || merged.dur < 1) && drop.dur) merged.dur = drop.dur;
  return merged;
}

function mergeDuplicateTasksInPhase(ph) {
  const groups = new Map();
  (ph.tasks || []).forEach((task) => {
    const key = normTaskName(task.name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(task);
  });

  const merged = [];
  let removed = 0;
  groups.forEach((tasks) => {
    if (tasks.length === 1) {
      merged.push(tasks[0]);
      return;
    }
    let acc = tasks[0];
    for (let i = 1; i < tasks.length; i += 1) {
      acc = mergeTaskPair(acc, tasks[i]);
      removed += 1;
    }
    merged.push(acc);
  });
  ph.tasks = merged;
  return removed;
}

function normalizeTask(task) {
  if (!task || typeof task !== 'object') return false;
  let changed = false;

  const who = canonicalizeWho(task.who);
  if (who !== (task.who || '')) {
    task.who = who;
    changed = true;
  }

  if (Array.isArray(task.comments)) {
    task.comments = task.comments.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const author = canonicalAssigneeName(c.author);
      if (author && author !== c.author) {
        changed = true;
        return { ...c, author };
      }
      return c;
    });
  }

  return changed;
}

export const ASSIGNEE_NAME_MIGRATE_VERSION = 2;

export function migrateAssigneeNamesState(state) {
  if (!state || typeof state !== 'object') return { state, changed: false, stats: {} };
  if ((state.assigneeNameMigrateVersion || 0) >= ASSIGNEE_NAME_MIGRATE_VERSION) {
    return { state, changed: false, stats: {} };
  }

  let whoUpdates = 0;
  let deptUpdates = 0;
  let tasksMerged = 0;

  (state.departments || []).forEach((d) => {
    const head = canonicalAssigneeName(d.head);
    if (head !== (d.head || '')) {
      d.head = head;
      deptUpdates += 1;
    }
  });

  (state.projects || []).forEach((proj) => {
    (proj.phases || []).forEach((ph) => {
      tasksMerged += mergeDuplicateTasksInPhase(ph);
      (ph.tasks || []).forEach((task) => {
        if (normalizeTask(task)) whoUpdates += 1;
      });
    });
  });

  state.assigneeNameMigrateVersion = ASSIGNEE_NAME_MIGRATE_VERSION;
  const changed = whoUpdates > 0 || deptUpdates > 0 || tasksMerged > 0;
  return { state, changed, stats: { whoUpdates, deptUpdates, tasksMerged } };
}
