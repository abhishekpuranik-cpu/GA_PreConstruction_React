/** Task status helpers — stored status + date-derived overdue / due heat */

export const TASK_STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'inprogress', label: 'In Progress' },
  { value: 'notstarted', label: 'Not Started' },
  { value: 'paused', label: 'Paused' },
];

/** Status options for multi-select filters (includes computed overdue). */
export const STATUS_FILTER_OPTIONS = [...TASK_STATUS_OPTIONS, { value: 'overdue', label: 'Overdue' }];

/** Days remaining at/under this count count as “nearing due” (amber). */
export const DUE_NEARING_DAYS = 7;

export const DUE_HEAT_COLORS = {
  missed: '#B32E1E',
  nearing: '#AE6418',
  ontrack: '#1A6A3C',
  completed: '#1A6A3C',
  paused: '#AE6418',
  none: '#9A9590',
};

/** @param {string} st — taskStatus() result @param {string[]} filters — empty = all */
export function taskMatchesStatusFilters(st, filters) {
  if (!filters?.length) return true;
  return filters.some((f) => (f === 'overdue' ? st === 'overdue' : st === f));
}

export function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function todayIso() {
  const d = todayDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoDayDiff(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / 864e5);
}

function commentTs(c) {
  const raw = c?.createdAt || c?.ts || '';
  const n = Date.parse(raw);
  return Number.isNaN(n) ? 0 : n;
}

/** Latest next-action date on the task (kept local to avoid import cycles with preconMyWork). */
function latestNextActionDate(comments) {
  let best = null;
  let bestScore = -1;
  for (const c of comments || []) {
    const date = String(c?.nextActionDate || '').trim();
    if (!date || Number.isNaN(new Date(date).getTime())) continue;
    const score = commentTs(c);
    if (score >= bestScore) {
      bestScore = score;
      best = date;
    }
  }
  return best;
}

/** Infer stored status from legacy as/ae fields when missing. */
export function ensureTaskStatus(t) {
  if (t.status) return t.status;
  if (t.ae) return 'completed';
  if (t.paused) return 'paused';
  if (t.as) return 'inprogress';
  return 'notstarted';
}

/**
 * Current due / work date: latest next-action date wins over planned schedule end.
 * Keeps overdue + calendar heat aligned with moved next-action dates.
 */
export function currentDueIso(t, dm) {
  const na = latestNextActionDate(t?.comments);
  if (na) return na;
  const end = dm?.[t?.id]?.e;
  const e = end ? String(end).trim() : '';
  if (e && !Number.isNaN(new Date(e).getTime())) return e;
  return null;
}

/**
 * Due-date heat for open work:
 * - missed (past) → red
 * - nearing (within DUE_NEARING_DAYS) → amber
 * - ontrack (well within) → green
 */
export function dueDateHeat(dueIso, { status, todayStr } = {}) {
  const stored = status || '';
  if (stored === 'completed') return 'completed';
  if (stored === 'paused') return 'paused';
  const due = String(dueIso || '').trim();
  if (!due) return 'none';
  const today = todayStr || todayIso();
  const daysLeft = isoDayDiff(today, due);
  if (daysLeft == null) return 'none';
  if (daysLeft < 0) return 'missed';
  if (daysLeft <= DUE_NEARING_DAYS) return 'nearing';
  return 'ontrack';
}

export function dueHeatColor(heat) {
  return DUE_HEAT_COLORS[heat] || DUE_HEAT_COLORS.none;
}

/** Heat for a calendar / work item (uses nextDate || dueDate || sortDate). */
export function workItemDueHeat(item) {
  const due = item?.nextDate || item?.dueDate || item?.sortDate || null;
  return dueDateHeat(due, { status: item?.st, todayStr: item?.todayStr });
}

/** Display status (includes overdue when current due is past and not completed/paused). */
export function taskStatus(t, dm) {
  const stored = ensureTaskStatus(t);
  if (stored === 'completed' || t.ae) return 'completed';
  if (stored === 'paused') return 'paused';
  const due = currentDueIso(t, dm);
  const pastDue = due && new Date(due) < todayDate();
  if (pastDue) return 'overdue';
  if (stored === 'notstarted') return 'notstarted';
  if (stored === 'inprogress' || t.as) return 'inprogress';
  const d = dm?.[t.id];
  if (!d) return 'notstarted';
  if (new Date(d.s) <= todayDate()) return 'inprogress';
  return 'notstarted';
}

export function statusLabel(st) {
  const m = {
    completed: 'Completed',
    inprogress: 'In Progress',
    notstarted: 'Not Started',
    paused: 'Paused',
    overdue: 'Overdue',
    upcoming: 'Not Started',
    missed: 'Due missed',
    nearing: 'Nearing due',
    ontrack: 'On track',
  };
  return m[st] || st;
}

export function statusBadgeClass(st) {
  const m = {
    completed: 'bcomp',
    inprogress: 'bip',
    notstarted: 'bup',
    paused: 'bpa',
    overdue: 'bov',
    upcoming: 'bup',
    missed: 'bov',
    nearing: 'bpa',
    ontrack: 'bcomp',
  };
  return m[st] || 'bup';
}

/** Stored value for <select> (never overdue). */
export function taskStatusSelectValue(t) {
  const s = ensureTaskStatus(t);
  if (s === 'completed' || t.ae) return 'completed';
  if (s === 'paused') return 'paused';
  if (s === 'inprogress' || t.as) return 'inprogress';
  return 'notstarted';
}
