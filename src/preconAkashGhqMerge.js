/**
 * Merge Golden HQ construction activities (Akash Borhade workbook) into project state.
 * Only removes tasks that explicitly duplicate the workbook — never broad fuzzy matching.
 * Preserves existing status, comments, dates, and assignees.
 */
import akashData from './data/ghqAkashActivities.json';
import { mergeLifecycleIntoProject } from './preconLifecycle.js';
import { applyGhqPreWorkToPhases } from './preconGhqPreWorkMigrate.js';

export const AKASH_GHQ_MERGE_VERSION = 2;

const PCOL = ['#1B5E9E', '#6B3FA0', '#B45309', '#1A6A3C', '#B32E1E', '#2A6E7A', '#7A3A2A', '#8A5A2A'];

/** Strip "Work area: " prefix used by CEME lifecycle tasks. */
function stripWorkAreaPrefix(name) {
  return String(name || '').replace(/^[^:]+:\s*/, '').trim();
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/^[ivxlc]+\.\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Only these existing tasks are removed — exact/near-exact duplicates of the workbook.
 * (v1 wrongly used fuzzy tasksMatch and deleted most of the project.)
 */
const REDUNDANT_NORMS = new Set(
  [
    'Shortlist excavation contractor',
    'Shortlist civil contractor',
    'Shortlist facade consultant',
    'Erect hoardings and barricades',
    'Set out grid & benchmarks',
    'Set out grid and benchmarks',
    'Install temporary power',
    'Install temporary water',
    'Install Temporary Water Supply',
    'On-site demolition completion',
    'Transformer shifting',
    'Site Clearance',
    'Demolition of Existing Structure',
    'Demolition of existing structure',
  ].map(norm)
);

const REDUNDANT_TASK_PATTERNS = [
  /^Shortlist excavation contractor$/i,
  /^Shortlist civil contractor$/i,
  /^Shortlist facade consultant$/i,
  /^Site Prep:\s*Erect hoardings and barricades$/i,
  /^Site Prep:\s*Set out grid/i,
  /^Site Prep:\s*Install temporary power$/i,
  /^Site Prep:\s*Install temporary water$/i,
  /^Site Prep:\s*Install Temporary Water Supply$/i,
  /^On-site demolition completion$/i,
  /^Transformer shifting$/i,
  /^Site Clearance$/i,
  /^Demolition of Existing Structure$/i,
];

function isExplicitlyRedundant(task) {
  const raw = String(task.name || '');
  const n = norm(stripWorkAreaPrefix(raw));
  if (REDUNDANT_NORMS.has(n)) return true;
  if (REDUNDANT_NORMS.has(norm(raw))) return true;
  return REDUNDANT_TASK_PATTERNS.some((re) => re.test(raw));
}

/** Strict duplicate check when adding workbook rows — no fuzzy word overlap. */
function strictDuplicate(nameA, nameB) {
  const a = norm(nameA);
  const b = norm(nameB);
  if (!a || !b) return false;
  return a === b;
}

function findPhase(phases, name) {
  const key = norm(name);
  return (phases || []).find((ph) => norm(ph.name) === key);
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

/** Fill only empty fields — never overwrite user progress. */
function patchAkashOntoExisting(existing, row) {
  if (!existing.ms && row.ms) existing.ms = row.ms;
  if (!existing.who && row.who) existing.who = row.who;
  if (!existing.plannedEnd && row.plannedEnd) existing.plannedEnd = row.plannedEnd;
  if (!existing.dur || existing.dur < 1) {
    existing.dur = Math.max(1, Number(row.dur) || 7);
  }
  existing.source = existing.source || 'akash_workbook';
}

function phaseColIndex(phaseName) {
  if (/site preparation/i.test(phaseName)) return 0;
  if (/pre-requisite/i.test(phaseName)) return 1;
  if (/external/i.test(phaseName)) return 2;
  return 3;
}

/**
 * Re-add CEME lifecycle + GHQ pre-work tasks removed by the v1 bad merge.
 */
export function repairGhqAfterBadAkashMerge(state) {
  const s = state && typeof state === 'object' ? state : null;
  if (!s || s.akashGhqActivitiesVersion !== 1) return s;
  const proj = (s.projects || []).find((p) => p.id === 'ghq' || p.id === akashData.projectId);
  if (proj) {
    mergeLifecycleIntoProject(proj);
    applyGhqPreWorkToPhases(proj.phases);
  }
  return s;
}

/**
 * @param {object} state
 * @returns {{ state: object, added: number, removed: number, skipped: number, repaired: boolean }}
 */
export function mergeAkashActivitiesIntoState(state) {
  const s = state && typeof state === 'object' ? state : { projects: [] };
  if (!Array.isArray(s.projects)) s.projects = [];

  const prevVersion = Number(s.akashGhqActivitiesVersion) || 0;
  let repaired = false;
  if (prevVersion === 1) {
    repairGhqAfterBadAkashMerge(s);
    repaired = true;
  }
  if (prevVersion >= AKASH_GHQ_MERGE_VERSION && !repaired) {
    return { state: s, added: 0, removed: 0, skipped: 0, repaired: false };
  }

  const proj = s.projects.find((p) => p.id === akashData.projectId || p.id === 'ghq');
  if (!proj) {
    s.akashGhqActivitiesVersion = AKASH_GHQ_MERGE_VERSION;
    return { state: s, added: 0, removed: 0, skipped: 0, repaired };
  }

  const incoming = akashData.tasks || [];
  let removed = 0;
  let added = 0;
  let skipped = 0;

  (proj.phases || []).forEach((ph) => {
    ph.tasks = (ph.tasks || []).filter((t) => {
      if (isExplicitlyRedundant(t)) {
        removed += 1;
        return false;
      }
      return true;
    });
  });

  incoming.forEach((row) => {
    const phaseName = row.phase || 'Site Preparation';
    const ph = ensurePhase(proj, phaseName, phaseColIndex(phaseName));

    const existing =
      ph.tasks.find((t) => t.id === row.id) ||
      ph.tasks.find((t) => strictDuplicate(t.name, row.name));

    if (existing) {
      patchAkashOntoExisting(existing, row);
      skipped += 1;
      return;
    }

    const existingElsewhere = (proj.phases || []).some((p) =>
      (p.tasks || []).some((t) => t.id === row.id || strictDuplicate(t.name, row.name))
    );
    if (existingElsewhere) {
      skipped += 1;
      return;
    }

    ph.tasks.push(mkAkashTask(row));
    added += 1;
  });

  s.akashGhqActivitiesVersion = AKASH_GHQ_MERGE_VERSION;
  return { state: s, added, removed, skipped, repaired };
}
