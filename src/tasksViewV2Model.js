/**
 * Read-only derivations for PhaseStrip (D2, D7, R1, R2, R3/D16).
 * Pure functions — clone inputs, never mutate props.
 * R4/R5/R6 removed with the V2 task table.
 */
import { cDates, dbDays } from './preconDates.js';
import { todayIso } from './preconTaskStatus.js';

function tasksOf(phase) {
  return Array.isArray(phase?.tasks) ? phase.tasks.slice() : [];
}

export function phaseTaskStats(phase) {
  const tasks = tasksOf(phase);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'completed').length;
  const complete = total > 0 && done === total;
  return { tasks, total, done, complete };
}

/** D2 — first incomplete phase; if all complete, last phase. Zero-task phases are not complete (R1). */
export function findCurrentPhaseIndex(phases) {
  const list = Array.isArray(phases) ? phases : [];
  if (!list.length) return -1;
  for (let i = 0; i < list.length; i += 1) {
    const { complete } = phaseTaskStats(list[i]);
    if (!complete) return i;
  }
  return list.length - 1;
}

function firstName(who) {
  const raw = String(who || '').trim();
  if (!raw) return '';
  const token = raw.split(/[,;/|]+/)[0]?.trim() || raw;
  return token.split(/\s+/)[0] || '';
}

/** D7 — owner = who with most incomplete tasks; ties alphabetical; else latest completed with ae. */
export function phaseOwnerFirstName(phase) {
  const tasks = tasksOf(phase);
  const incompleteCounts = new Map();
  for (const t of tasks) {
    if (t.status === 'completed') continue;
    const who = String(t.who || '').trim();
    if (!who) continue;
    incompleteCounts.set(who, (incompleteCounts.get(who) || 0) + 1);
  }
  if (incompleteCounts.size) {
    let bestWho = '';
    let bestCount = -1;
    const keys = [...incompleteCounts.keys()].sort((a, b) => a.localeCompare(b));
    for (const who of keys) {
      const n = incompleteCounts.get(who);
      if (n > bestCount) {
        bestCount = n;
        bestWho = who;
      }
    }
    return firstName(bestWho);
  }
  const completed = tasks
    .filter((t) => t.status === 'completed' && String(t.who || '').trim() && t.ae)
    .slice()
    .sort((a, b) => String(b.ae).localeCompare(String(a.ae)));
  if (completed.length) return firstName(completed[0].who);
  return '';
}

/**
 * R2 — planned window from tasks that have both ms and dur.
 * Uses cDates(proj) for end dates.
 */
export function phasePlannedWindow(proj, phase) {
  const dm = cDates(proj);
  const tasks = tasksOf(phase);
  let plannedStart = null;
  let plannedEnd = null;
  for (const t of tasks) {
    const ms = t.ms;
    const dur = t.dur;
    if (ms == null || ms === '') continue;
    if (dur == null || dur === '' || Number.isNaN(Number(dur))) continue;
    const end = dm[t.id]?.e;
    if (!end) continue;
    const start = String(ms);
    if (!plannedStart || start < plannedStart) plannedStart = start;
    if (!plannedEnd || end > plannedEnd) plannedEnd = end;
  }
  if (!plannedStart || !plannedEnd) return null;
  return { plannedStart, plannedEnd };
}

/**
 * R3 / D16 — large metric for the current tile.
 * Future plannedStart → show the date, not a countdown.
 */
export function currentPhaseMetric(proj, phase, stats) {
  const window = phasePlannedWindow(proj, phase);
  const today = todayIso();
  if (!window) {
    return {
      kind: 'tasks',
      value: `${stats.done}/${stats.total}`,
      label: 'tasks complete',
      tone: 'ink',
    };
  }
  if (window.plannedStart > today) {
    return {
      kind: 'start',
      value: window.plannedStart,
      label: 'planned start',
      tone: 'ink',
    };
  }
  if (today > window.plannedEnd) {
    return {
      kind: 'past',
      value: String(Math.max(0, dbDays(window.plannedEnd, today))),
      label: 'd past plan',
      tone: 'danger',
    };
  }
  return {
    kind: 'remaining',
    value: String(Math.max(0, dbDays(today, window.plannedEnd))),
    label: 'd to plan end',
    tone: 'ink',
  };
}

export function buildPhaseStripModel(proj) {
  const phases = Array.isArray(proj?.phases) ? proj.phases.slice() : [];
  const currentIndex = findCurrentPhaseIndex(phases);
  return phases.map((phase, index) => {
    const stats = phaseTaskStats(phase);
    let state = 'future';
    if (stats.total === 0) state = 'future';
    else if (stats.complete) state = 'complete';
    else if (index === currentIndex) state = 'current';
    else if (index < currentIndex) state = 'complete';
    else state = 'future';

    const owner = phaseOwnerFirstName(phase);
    const metric = state === 'current' ? currentPhaseMetric(proj, phase, stats) : null;
    return {
      id: phase.id,
      name: phase.name || '—',
      index,
      state,
      stats,
      owner,
      metric,
      phase,
    };
  });
}

/**
 * True only when V1 `.psh` count matches `phases.length` (1:1 index alignment).
 * Design&Approvals split or filter-hidden phases break this — highlight-only then.
 */
export function canScrollByPhaseIndex(phaseCount) {
  if (typeof document === 'undefined') return false;
  const n = document.querySelectorAll('.psh').length;
  return n > 0 && n === phaseCount;
}

export function scrollToPhaseHeader(phaseIndex) {
  if (typeof document === 'undefined') return;
  const headers = document.querySelectorAll('.psh');
  const el = headers[phaseIndex];
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
