/**
 * Golden HQ "Pre-Work Start Follow-up" tasks → canonical lifecycle phases (consultant mapping).
 * Removes the standalone pws phase after redistribution.
 */

const PWS_PHASE_RE = /pre-work start follow-up/i;

/** @type {{ match: RegExp, taskMatch?: RegExp, insertAfter?: RegExp }[]} */
export const PREWORK_TASK_ROUTING = [
  { match: /regulatory approval/i, taskMatch: /demolition order/i },
  { match: /regulatory approval/i, taskMatch: /plan sanction/i, insertAfter: /building plan sanction/i },
  { match: /regulatory approval/i, taskMatch: /msedcl/i },
  { match: /regulatory approval/i, taskMatch: /royalty order/i },
  { match: /regulatory approval/i, taskMatch: /tree cutting/i },
  { match: /regulatory approval/i, taskMatch: /plantation contract/i },
  { match: /regulatory approval/i, taskMatch: /blasting permission/i },
  { match: /design & team|design & approval/i, taskMatch: /p\.t\. drawing|pt drawing/i },
  { match: /project financial/i, taskMatch: /parking vendor/i },
  { match: /site preparation/i, taskMatch: /transformer shifting/i },
  { match: /site preparation/i, taskMatch: /construction meter/i },
  { match: /site preparation/i, taskMatch: /dry-type transformer/i },
  { match: /construction pre-requisite/i, taskMatch: /shore pile/i },
  { match: /construction pre-requisite/i, taskMatch: /on-site demolition/i },
];

function findPhase(phases, pattern) {
  return (phases || []).find((ph) => pattern.test(String(ph.name || '')));
}

function normTaskName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function phaseHasTask(ph, task) {
  const n = normTaskName(task.name);
  return (ph.tasks || []).some(
    (t) => t.id === task.id || normTaskName(t.name) === n || normTaskName(t.name).includes(n)
  );
}

function insertTask(ph, task, insertAfterPattern) {
  if (!ph.tasks) ph.tasks = [];
  if (phaseHasTask(ph, task)) return;
  if (!insertAfterPattern) {
    ph.tasks.push(task);
    return;
  }
  const idx = ph.tasks.findIndex((t) => insertAfterPattern.test(String(t.name || '')));
  if (idx >= 0) ph.tasks.splice(idx + 1, 0, task);
  else ph.tasks.push(task);
}

function routeTask(phases, task) {
  const name = String(task.name || '').toLowerCase();
  const route = PREWORK_TASK_ROUTING.find((r) => {
    if (r.taskMatch && !r.taskMatch.test(name)) return false;
    return findPhase(phases, r.match);
  });
  if (!route) {
    const fallback =
      findPhase(phases, /regulatory/) ||
      findPhase(phases, /construction pre-requisite/) ||
      findPhase(phases, /site preparation/);
    if (fallback) insertTask(fallback, task);
    return;
  }
  const ph = findPhase(phases, route.match);
  insertTask(ph, task, route.insertAfter);
}

function remapPreds(task, idMap) {
  task.pred = (task.pred || []).map((p) => idMap[p] || p).filter(Boolean);
}

/**
 * Move all tasks out of Pre-Work Start Follow-up into lifecycle phases; drop empty pws phase.
 * @returns {boolean} true if migration ran
 */
export function migratePreWorkFollowUpProject(proj) {
  if (!proj?.phases) return false;
  const pwsIdx = proj.phases.findIndex((ph) => PWS_PHASE_RE.test(ph.name || ''));
  if (pwsIdx < 0) return false;

  const pws = proj.phases[pwsIdx];
  const tasks = [...(pws.tasks || [])];
  const idMap = {};

  tasks.forEach((t) => {
    const oldId = t.id;
    routeTask(proj.phases, { ...t });
    idMap[oldId] = t.id;
  });

  proj.phases.forEach((ph) => {
    (ph.tasks || []).forEach((t) => remapPreds(t, idMap));
  });

  proj.phases.splice(pwsIdx, 1);
  return true;
}

export function migratePreWorkFollowUpState(state) {
  if (!state?.projects) return state;
  let n = 0;
  state.projects.forEach((proj) => {
    if (migratePreWorkFollowUpProject(proj)) n += 1;
  });
  if (n > 0) state.preWorkMigrated = true;
  return state;
}

/** Build Golden HQ pre-work tasks for seeding (no separate phase). */
export function ghqPreWorkTasksForSeed() {
  const note = (text) => (text ? [{ author: 'Follow-up sheet', text }] : []);
  const t = (id, name, ms, who, remark, dur = 7, pred = []) => ({
    id,
    name,
    dur,
    pred,
    par: null,
    ms,
    who: who || '',
    roles: [],
    comments: note(remark),
    as: null,
    ae: null,
    status: 'notstarted',
  });

  return {
    regulatory: [
      t(
        'ghq_ws01',
        'Demolition order',
        '2026-06-02',
        'Amit & Ashish',
        'With sanction may receive; confirm if separate permission is required.',
        14,
        ['re17']
      ),
      t('ghq_ws02', 'Plan sanction (authority confirmation)', '2026-06-15', '', '', 7, ['re17']),
      t('ghq_ws03', 'MSEDCL franchise model review', '2026-06-20', 'Amit & Minal', '', 7, ['re3']),
      t(
        'ghq_ws06',
        'Royalty order (permissions & licences with GA)',
        '2026-07-06',
        'Amit & Minal',
        'Contractor scope — retain all permissions and licences.',
        14
      ),
      t('ghq_ws07', 'Tree cutting permission (final order)', '2026-07-15', 'Amit & Minal', '', 14, ['re9']),
      t(
        'ghq_ws09',
        'Plantation contract with vendor',
        '2026-07-20',
        'Amit & Minal',
        '7-year maintenance contract; six-monthly reports.',
        14
      ),
      t(
        'ghq_ws10',
        'Blasting permission',
        '2026-07-25',
        'Amit & Minal',
        'Contractor scope — retain all permissions and licences.',
        14,
        ['ghq_ws07']
      ),
    ],
    design: [
      t(
        'ghq_ws11',
        'P.T. drawing costing (final quantities)',
        '2026-07-30',
        'Amar, Minal, Namdeo',
        'Costing received; reconcile after drawing finalization.',
        14,
        ['de9']
      ),
    ],
    financial: [
      t('ghq_ws08', 'Parking vendor — parking management', '2026-07-16', 'Minal', '', 14, ['fi6']),
    ],
    sitePrep: [
      t('ghq_ws04', 'Shore pile vendor finalization', '2026-06-24', '', 'First step before excavation.', 14),
      t('ghq_ws05', 'On-site demolition completion', '2026-06-30', '', 'On-site demolition completion.', 14, [
        'ghq_ws01',
      ]),
      t(
        'ghq_ws12',
        'Transformer shifting',
        '2026-08-10',
        'Mahesh Bhusare',
        'Permission valid till September; complete before blasting works.',
        21,
        ['ghq_ws10']
      ),
      t('ghq_ws13', 'Construction meter sanction', '2026-10-05', 'Ashish & Minal', 'After transformer shifting.', 14, [
        'ghq_ws12',
      ]),
      t(
        'ghq_ws14',
        'Dry-type transformer sanction',
        '2027-03-15',
        'Amit & Minal',
        'Stand-by transformer required for dry-type approval.',
        30,
        ['ghq_ws13']
      ),
    ],
  };
}

export function applyGhqPreWorkToPhases(phases) {
  const seed = ghqPreWorkTasksForSeed();
  const pr = findPhase(phases, /regulatory approval/i);
  const pd = findPhase(phases, /design & team/i);
  const pf = findPhase(phases, /project financial/i);
  const site =
    findPhase(phases, /site preparation/i) || findPhase(phases, /construction pre-requisite/i);

  if (pr) seed.regulatory.forEach((task) => insertTask(pr, task, /building plan sanction/i));
  if (pd) seed.design.forEach((task) => insertTask(pd, task));
  if (pf) seed.financial.forEach((task) => insertTask(pf, task));
  if (site) seed.sitePrep.forEach((task) => insertTask(site, task));

  return phases;
}
