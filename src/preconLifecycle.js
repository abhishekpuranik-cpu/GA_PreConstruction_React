/**
 * CEME development lifecycle (excludes Construction Execution except Site Preparation).
 * Merges template tasks into projects; schedules from kickoff via predecessors + offsetFromKo.
 */
import lifecycleData from './data/cemeLifecycle.json';
import { ensureStateDepartments } from './preconDepartments.js';

const PCOL = ['#1B5E9E', '#6B3FA0', '#B45309', '#1A6A3C', '#B32E1E', '#2A6E7A', '#7A3A2A', '#8A5A2A'];

export const LIFECYCLE_VERSION = lifecycleData.version || 1;

const PHASE_SLUG_ALIASES = {
  land_acquisition_feasibility: [
    'land acquisition',
    'land acquisition & feasibility',
    'technical & legal due diligence',
  ],
  project_financial_working: [
    'project financial working',
    'project finnancial working',
    'concept & product planning',
  ],
  design_approvals: ['design & approvals', 'design & team appointments', 'regulatory approvals'],
  financing_pre_construction: ['financing & pre-construction'],
  site_preparation: ['site preparation', 'site prep'],
  marketing_sales: ['marketing & sales'],
  sales_office_setup: ['sales office setup'],
  handover_post_sales: ['handover & post-sales', 'handover'],
  closure_exit: ['closure & exit'],
  registration: ['registration'],
};

const CUSTOM_PHASE_KEEP = /sales office setup|construction pre-requisite/i;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^[^:]+:\s*/, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tasksMatch(nameA, nameB) {
  const a = norm(nameA);
  const b = norm(nameB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const wa = new Set(a.split(' ').filter((w) => w.length > 3));
  const wb = new Set(b.split(' ').filter((w) => w.length > 3));
  let inter = 0;
  wa.forEach((w) => {
    if (wb.has(w)) inter += 1;
  });
  const need = Math.min(3, Math.min(wa.size, wb.size, wb.size || 1));
  return inter >= need;
}

function findPhaseByTemplate(proj, templatePhase) {
  const slug = templatePhase.slug;
  const keys = [
    templatePhase.name.toLowerCase(),
    slug.replace(/_/g, ' '),
    ...(PHASE_SLUG_ALIASES[slug] || []),
  ];
  return (proj.phases || []).find((ph) => {
    const n = (ph.name || '').toLowerCase();
    return keys.some((k) => n === k || n.includes(k) || k.includes(n));
  });
}

function findTaskInProject(proj, taskName) {
  for (const ph of proj.phases || []) {
    for (const t of ph.tasks || []) {
      if (tasksMatch(t.name, taskName)) return { phase: ph, task: t };
    }
  }
  return null;
}

function stripConstructionPhases(proj) {
  proj.phases = (proj.phases || []).filter((ph) => {
    const n = (ph.name || '').toLowerCase();
    if (CUSTOM_PHASE_KEEP.test(ph.name || '')) return true;
    if (/construction execution/.test(n)) return false;
    if (n === 'construction') return false;
    return true;
  });
}

function mkTaskFromTemplate(tpl, pid, idMap) {
  const id = `${pid}_${tpl.id}`;
  idMap[tpl.id] = id;
  const preds = (tpl.pred || [])
    .map((p) => idMap[p] || `${pid}_${p}`)
    .filter(Boolean);
  return {
    id,
    name: tpl.workArea ? `${tpl.workArea}: ${tpl.name}` : tpl.name,
    dur: Math.max(1, Number(tpl.dur) || 7),
    pred: preds,
    par: tpl.par || null,
    ms: null,
    who: '',
    comments: tpl.brief ? [{ author: 'CEME', text: tpl.brief, ts: '' }] : [],
    as: null,
    ae: null,
    status: 'notstarted',
    offsetFromKo: tpl.offsetFromKo != null ? Number(tpl.offsetFromKo) : null,
    roles: Array.isArray(tpl.roles) ? [...tpl.roles] : [],
  };
}

function ensurePhase(proj, templatePhase, colIndex) {
  let ph = findPhaseByTemplate(proj, templatePhase);
  if (!ph) {
    ph = {
      id: `ph_${templatePhase.slug}_${proj.id}`,
      name: templatePhase.name,
      col: PCOL[colIndex % PCOL.length],
      open: colIndex < 2,
      tasks: [],
    };
    proj.phases.push(ph);
  }
  return ph;
}

/**
 * Build full lifecycle phases for a new project (all template tasks).
 */
export function buildLifecyclePhasesForProject(projectId) {
  const idMap = {};
  const phases = [];
  (lifecycleData.phases || []).forEach((templatePhase, idx) => {
    const tasks = (templatePhase.tasks || []).map((tpl) => {
      const t = mkTaskFromTemplate(tpl, projectId, idMap);
      return t;
    });
    phases.push({
      id: `ph_${templatePhase.slug}_${projectId}`,
      name: templatePhase.name,
      col: PCOL[idx % PCOL.length],
      open: idx < 2,
      tasks,
    });
  });
  return phases;
}

/**
 * Merge missing CEME lifecycle tasks into an existing project (non-destructive).
 */
export function mergeLifecycleIntoProject(proj) {
  if (!proj?.id) return { added: 0, phases: 0 };
  stripConstructionPhases(proj);
  if (!Array.isArray(proj.phases)) proj.phases = [];

  const idMap = {};
  let added = 0;
  let phasesTouched = 0;

  (proj.phases || []).forEach((ph) => {
    (ph.tasks || []).forEach((t) => {
      const tail = String(t.id || '').split('_').slice(1).join('_');
      if (tail) idMap[tail] = t.id;
      idMap[t.id] = t.id;
    });
  });

  (lifecycleData.phases || []).forEach((templatePhase, idx) => {
    const ph = ensurePhase(proj, templatePhase, idx);
    phasesTouched += 1;

    (templatePhase.tasks || []).forEach((tpl) => {
      const existing = findTaskInProject(proj, tpl.name);
      if (existing) {
        idMap[tpl.id] = existing.task.id;
        if (tpl.offsetFromKo != null && existing.task.offsetFromKo == null) {
          existing.task.offsetFromKo = Number(tpl.offsetFromKo);
        }
        if (tpl.roles?.length && (!existing.task.roles || !existing.task.roles.length)) {
          existing.task.roles = [...tpl.roles];
        }
        return;
      }

      const nt = mkTaskFromTemplate(tpl, proj.id, idMap);
      const predsResolved = (tpl.pred || [])
        .map((p) => idMap[p])
        .filter((x) => x && x !== nt.id);
      nt.pred = predsResolved;
      ph.tasks.push(nt);
      idMap[tpl.id] = nt.id;
      added += 1;
    });
  });

  applyKickoffOffsets(proj);
  return { added, phases: phasesTouched };
}

/**
 * Apply offsetFromKo → manual start (ms) from project kickoff.
 */
export function applyKickoffOffsets(proj) {
  if (!proj?.ko) return;
  const ko = new Date(proj.ko);
  if (Number.isNaN(ko.getTime())) return;
  const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const iso = (d) => {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  (proj.phases || []).forEach((ph) => {
    (ph.tasks || []).forEach((t) => {
      if (t.offsetFromKo != null && t.offsetFromKo !== '' && !Number.isNaN(Number(t.offsetFromKo))) {
        t.ms = iso(addDays(ko, Number(t.offsetFromKo)));
      }
    });
  });
}

export function mergeLifecycleIntoState(state) {
  const s = state && typeof state === 'object' ? state : { projects: [] };
  if (!Array.isArray(s.projects)) s.projects = [];
  let totalAdded = 0;
  s.projects.forEach((proj) => {
    const { added } = mergeLifecycleIntoProject(proj);
    totalAdded += added;
  });
  s.lifecycleVersion = LIFECYCLE_VERSION;
  ensureStateDepartments(s);
  return { state: s, totalAdded };
}

export function getLifecyclePhaseNames() {
  return (lifecycleData.phases || []).map((p) => p.name);
}
