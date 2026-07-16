/**
 * Portfolio RAG matrix — McKinsey-style phase × project health view.
 */
import { cDates, dbDays } from './preconDates.js';
import { taskStatus, statusLabel, todayIso } from './preconTaskStatus.js';
import { getDepartmentForPhase } from './preconDepartments.js';
import { commentSortKey } from './preconComments.js';

export const RAG_COLORS = {
  green: { bg: '#1A6A3C', light: '#EAF5EE', border: '#A8DEB8', label: 'On track' },
  amber: { bg: '#AE6418', light: '#FDF3E8', border: '#E8C490', label: 'At risk' },
  red: { bg: '#B32E1E', light: '#FCECEA', border: '#EFBAB0', label: 'Off track' },
  gray: { bg: '#9A9590', light: '#F5F3EE', border: '#E2DDD4', label: 'Not started' },
  na: { bg: '#CEC8BB', light: '#FAFAF8', border: '#E2DDD4', label: 'N/A' },
};

/** Canonical portfolio columns (screenshot order). */
export const PORTFOLIO_PHASE_COLUMNS = [
  {
    id: 'land',
    label: 'Land Acquisition & Feasibility',
    short: 'Land & Feasibility',
    match: ['land acquisition', 'technical & legal due diligence', 'due diligence'],
  },
  {
    id: 'financial',
    label: 'Project Financial Working',
    short: 'Financial Working',
    match: ['project financial', 'project finnancial', 'concept & product'],
  },
  { id: 'registration', label: 'Registration', short: 'Registration', match: ['registration'] },
  {
    id: 'design',
    label: 'Design & Approvals',
    short: 'Design & Approvals',
    match: ['design & approval', 'design & team', 'regulatory approval'],
  },
  {
    id: 'financing',
    label: 'Financing & Pre-Construction',
    short: 'Financing',
    match: ['financing & pre', 'financing and pre'],
  },
  {
    id: 'construction',
    label: 'Site Preparation',
    short: 'Site Prep',
    match: ['site preparation', 'site prep', 'demolition', 'construction execution', 'construction pre-requisite'],
  },
  { id: 'marketing', label: 'Marketing & Sales', short: 'Marketing', match: ['marketing & sales', 'marketing and sales'] },
  { id: 'sales_office', label: 'Sales Office Setup', short: 'Sales Office', match: ['sales office'] },
  {
    id: 'handover',
    label: 'Handover & Post-Sales',
    short: 'Handover',
    match: ['handover', 'post-sales', 'post sales'],
  },
  { id: 'closure', label: 'Closure & Exit', short: 'Closure', match: ['closure & exit', 'closure'] },
];

function normPhase(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function phasesForColumn(proj, column) {
  const keys = (column.match || []).map((m) => normPhase(m));
  return (proj.phases || []).filter((ph) => {
    const n = normPhase(ph.name);
    return keys.some((k) => n === k || n.includes(k) || k.includes(n));
  });
}

function parseCommentTs(c) {
  return commentSortKey(c);
}

export function getLatestIssue(tasks) {
  let best = null;
  let bestScore = -1;
  for (const { task, phase } of tasks) {
    for (const c of task.comments || []) {
      const score = parseCommentTs(c) + (c.flag ? 1e12 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = {
          text: c.text || '',
          author: c.author || 'Anon',
          ts: c.ts || '',
          nextAction: c.nextAction || '',
          nextActionDate: c.nextActionDate || '',
          flagged: !!c.flag,
          taskName: task.name,
          phaseName: phase?.name || '',
        };
      }
    }
  }
  return best;
}

export function getCurrentActivity(tasks, dm, todayStr) {
  const ranked = tasks
    .map(({ task, phase }) => ({ task, phase, st: taskStatus(task, dm), d: dm[task.id] }))
    .filter((x) => x.st !== 'completed');

  const order = { overdue: 0, inprogress: 1, paused: 2, notstarted: 3, upcoming: 4 };
  ranked.sort((a, b) => {
    const oa = order[a.st] ?? 5;
    const ob = order[b.st] ?? 5;
    if (oa !== ob) return oa - ob;
    const ea = a.d?.e ? new Date(a.d.e).getTime() : 9e15;
    const eb = b.d?.e ? new Date(b.d.e).getTime() : 9e15;
    return ea - eb;
  });

  const pick = ranked[0];
  if (!pick) {
    const done = tasks.filter((x) => taskStatus(x.task, dm) === 'completed');
    const last = done[done.length - 1];
    if (last) {
      return {
        task: last.task,
        phase: last.phase,
        status: 'completed',
        label: 'Phase complete',
        end: dm[last.task.id]?.e,
      };
    }
    return null;
  }

  return {
    task: pick.task,
    phase: pick.phase,
    status: pick.st,
    label: statusLabel(pick.st),
    start: pick.d?.s,
    end: pick.d?.e,
    overdueDays: pick.st === 'overdue' && pick.d?.e ? dbDays(pick.d.e, todayStr) : 0,
  };
}

export function computePhaseCell(proj, column, departments) {
  const matchedPhases = phasesForColumn(proj, column);
  const dm = cDates(proj);
  const todayStr = todayIso();
  const tasks = [];
  matchedPhases.forEach((ph) => {
    (ph.tasks || []).forEach((task) => tasks.push({ task, phase: ph }));
  });

  if (!tasks.length) {
    return {
      rag: 'na',
      pct: 0,
      total: 0,
      completed: 0,
      overdue: 0,
      inProgress: 0,
      flagged: 0,
      current: null,
      issue: null,
      dept: null,
      summary: 'No activities mapped',
    };
  }

  let completed = 0;
  let overdue = 0;
  let inProgress = 0;
  let flagged = 0;
  tasks.forEach(({ task }) => {
    const st = taskStatus(task, dm);
    if (st === 'completed') completed += 1;
    if (st === 'overdue') overdue += 1;
    if (st === 'inprogress') inProgress += 1;
    if ((task.comments || []).some((c) => c.flag)) flagged += 1;
  });

  const total = tasks.length;
  const pct = Math.round((completed / total) * 100);
  const current = getCurrentActivity(tasks, dm, todayStr);
  const issue = getLatestIssue(tasks);
  const dept = matchedPhases[0] ? getDepartmentForPhase(matchedPhases[0].name, departments) : null;

  let rag = 'gray';
  if (pct === 100) rag = 'green';
  else if (overdue >= Math.max(1, Math.ceil(total * 0.15)) || (flagged && overdue > 0)) rag = 'red';
  else if (overdue > 0 || flagged || (inProgress > 0 && pct < 100)) rag = 'amber';
  else if (pct > 0 || inProgress > 0) rag = 'amber';
  else rag = 'gray';

  const summary =
    pct === 100
      ? 'Complete'
      : `${pct}% done · ${overdue ? `${overdue} overdue` : `${inProgress} active`}`;

  return {
    rag,
    pct,
    total,
    completed,
    overdue,
    inProgress,
    flagged,
    current,
    issue,
    dept,
    summary,
    phaseNames: matchedPhases.map((p) => p.name),
  };
}

export function buildPortfolioMatrix(projects, departments) {
  return (projects || []).map((proj) => ({
    proj,
    cells: PORTFOLIO_PHASE_COLUMNS.map((col) => ({
      column: col,
      ...computePhaseCell(proj, col, departments),
    })),
  }));
}

export function computePortfolioMetrics(projects, departments) {
  const matrix = buildPortfolioMatrix(projects, departments);
  let green = 0;
  let amber = 0;
  let red = 0;
  let gray = 0;
  let flaggedIssues = 0;
  let overdueTasks = 0;
  let totalTasks = 0;
  let completedTasks = 0;
  const atRiskProjects = new Set();

  matrix.forEach((row) => {
    let projRed = false;
    row.cells.forEach((cell) => {
      if (cell.rag === 'green') green += 1;
      else if (cell.rag === 'amber') amber += 1;
      else if (cell.rag === 'red') {
        red += 1;
        projRed = true;
      } else if (cell.rag === 'gray') gray += 1;
      if (cell.issue?.flagged) flaggedIssues += 1;
      overdueTasks += cell.overdue || 0;
      totalTasks += cell.total || 0;
      completedTasks += cell.completed || 0;
    });
    if (projRed) atRiskProjects.add(row.proj.id);
  });

  const activeTasks = totalTasks - completedTasks;
  const onTimePct =
    activeTasks > 0 ? Math.round(((activeTasks - overdueTasks) / activeTasks) * 100) : 100;
  const portfolioPct = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return {
    matrix,
    green,
    amber,
    red,
    gray,
    flaggedIssues,
    overdueTasks,
    totalTasks,
    completedTasks,
    portfolioPct,
    onTimePct,
    atRiskCount: atRiskProjects.size,
    cellCount: projects.length * PORTFOLIO_PHASE_COLUMNS.length,
  };
}
