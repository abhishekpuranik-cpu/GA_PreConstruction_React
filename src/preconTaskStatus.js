/** Task status helpers — stored status + date-derived overdue */

export const TASK_STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'inprogress', label: 'In Progress' },
  { value: 'notstarted', label: 'Not Started' },
  { value: 'paused', label: 'Paused' },
];

export function todayDate() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function todayIso() {
  const d = todayDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Infer stored status from legacy as/ae fields when missing. */
export function ensureTaskStatus(t) {
  if (t.status) return t.status;
  if (t.ae) return 'completed';
  if (t.paused) return 'paused';
  if (t.as) return 'inprogress';
  return 'notstarted';
}

/** Display status (includes overdue when past end and not completed/paused). */
export function taskStatus(t, dm) {
  const stored = ensureTaskStatus(t);
  if (stored === 'completed' || t.ae) return 'completed';
  if (stored === 'paused') return 'paused';
  const d = dm?.[t.id];
  const pastDue = d && new Date(d.e) < todayDate();
  if (pastDue && stored !== 'completed' && stored !== 'paused') return 'overdue';
  if (stored === 'notstarted') return 'notstarted';
  if (stored === 'inprogress' || t.as) return 'inprogress';
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
