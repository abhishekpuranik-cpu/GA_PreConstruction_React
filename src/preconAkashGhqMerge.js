/**
 * Merge Golden HQ construction activities (Akash Borhade workbook) into project state.
 * Removes redundant overlapping tasks; adds dated sub-activities with assignees.
 */
import akashData from './data/ghqAkashActivities.json';
import { tasksMatch } from './preconLifecycle.js';

export const AKASH_GHQ_MERGE_VERSION = akashData.version || 1;

const PCOL = ['#1B5E9E', '#6B3FA0', '#B45309', '#1A6A3C', '#B32E1E', '#2A6E7A', '#7A3A2A', '#8A5A2A'];

/** Existing seed tasks superseded by the Akash site/construction workbook. */
const REDUNDANT_TASK_PATTERNS = [
  /^Shortlist excavation contractor$/i,
  /^Shortlist civil contractor$/i,
  /^Shortlist facade consultant$/i,
  /^Site Prep:\s*Erect hoardings and barricades$/i,
  /^Site Prep:\s*Set out grid & benchmarks$/i,
  /^Site Prep:\s*Install temporary power$/i,
  /^Site Prep:\s*Install temporary water$/i,
  /^Site Prep:\s*Install Temporary Water Supply$/i,
  /on-site demolition completion/i,
  /^Transformer shifting$/i,
  /^Site Clearance$/i,
  /^Demolition of Existing Structure$/i,
  /^Demolition of existing structure$/i,
];

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function taskRedundantWithAkash(task, akashNames) {
  const n = String(task.name || '');
  if (REDUNDANT_TASK_PATTERNS.some((re) => re.test(n))) return true;
  return akashNames.some((a) => tasksMatch(a, n));
}

function findPhase(phases, name) {
  const key = norm(name);
  return (phases || []).find((ph) => {
    const n = norm(ph.name);
    return n === key || n.includes(key) || key.includes(n);
  });
}

function ensurePhase(proj, phaseName, colIndex) {
  let ph = findPhase(proj.phases, phaseName);
  if (!ph) {
    const slug = norm(phaseName).replace(/\s+/g, '_').slice(0, 32);
    ph = {
      id: `ph_akash_${slug}_${proj.id}`,
      name: phaseName,
      col: PCOL[colIndex % PCOL.length],
      open: /site preparation|construction pre-requisite/i.test(phaseName),
      tasks: [],
    };
    proj.phases.push(ph);
  }
  if (!Array.isArray(ph.tasks)) ph.tasks = [];
  return ph;
}

function mkAkashTask(row) {
  const comments = row.remark
    ? [{ author: 'Akash workbook', text: row.remark, ts: '', createdAt: row.ms || '' }]
    : [];
  if (row.parent) {
    comments.unshift({
      author: 'Akash workbook',
      text: `Sub-activity of: ${row.parent}`,
      ts: '',
      createdAt: row.ms || '',
    });
  }
  return {
    id: row.id,
    name: row.name,
    dur: Math.max(1, Number(row.dur) || 7),
    pred: [],
    par: null,
    ms: row.ms || null,
    ae: null,
    as: null,
    who: row.who || '',
    roles: [],
    comments,
    status: 'notstarted',
    plannedEnd: row.plannedEnd || null,
    source: 'akash_workbook',
  };
}

function phaseColIndex(phaseName) {
  if (/site preparation/i.test(phaseName)) return 0;
  if (/pre-requisite/i.test(phaseName)) return 1;
  if (/external/i.test(phaseName)) return 2;
  return 3;
}

/**
 * @param {object} state
 * @returns {{ state: object, added: number, removed: number, skipped: number }}
 */
export function mergeAkashActivitiesIntoState(state) {
  const s = state && typeof state === 'object' ? state : { projects: [] };
  if (!Array.isArray(s.projects)) s.projects = [];
  if (s.akashGhqActivitiesVersion >= AKASH_GHQ_MERGE_VERSION) {
    return { state: s, added: 0, removed: 0, skipped: 0 };
  }

  const proj = s.projects.find((p) => p.id === akashData.projectId || p.id === 'ghq');
  if (!proj) {
    s.akashGhqActivitiesVersion = AKASH_GHQ_MERGE_VERSION;
    return { state: s, added: 0, removed: 0, skipped: 0 };
  }

  const incoming = akashData.tasks || [];
  const akashNames = incoming.map((t) => t.name);
  let removed = 0;
  let added = 0;
  let skipped = 0;

  (proj.phases || []).forEach((ph) => {
    const before = (ph.tasks || []).length;
    ph.tasks = (ph.tasks || []).filter((t) => {
      if (taskRedundantWithAkash(t, akashNames)) {
        removed += 1;
        return false;
      }
      return true;
    });
    if (ph.tasks.length < before && /pre-work start follow-up/i.test(ph.name)) {
      if (!ph.tasks.length) {
        proj.phases = proj.phases.filter((x) => x.id !== ph.id);
      }
    }
  });

  incoming.forEach((row) => {
    const phaseName = row.phase || 'Site Preparation';
    const ph = ensurePhase(proj, phaseName, phaseColIndex(phaseName));
    const exists = ph.tasks.some(
      (t) => t.id === row.id || tasksMatch(t.name, row.name)
    );
    if (exists) {
      skipped += 1;
      const existing = ph.tasks.find((t) => t.id === row.id || tasksMatch(t.name, row.name));
      if (existing) {
        if (row.ms && !existing.ms) existing.ms = row.ms;
        if (row.who && !existing.who) existing.who = row.who;
        if (row.plannedEnd) existing.plannedEnd = row.plannedEnd;
        existing.dur = Math.max(existing.dur || 1, Number(row.dur) || 7);
        existing.source = 'akash_workbook';
      }
      return;
    }
    ph.tasks.push(mkAkashTask(row));
    added += 1;
  });

  s.akashGhqActivitiesVersion = AKASH_GHQ_MERGE_VERSION;
  return { state: s, added, removed, skipped };
}
