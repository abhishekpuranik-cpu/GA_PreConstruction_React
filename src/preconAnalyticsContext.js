import { cDates, dbDays } from './preconDates.js';
import { ensureTaskStatus, taskStatus, todayIso } from './preconTaskStatus.js';
import { getLatestNextActionEntry } from './preconMyWork.js';
import { assessTaskCompliance } from './preconCompliance.js';
import { taskParentId } from './preconTaskTree.js';

const MAX_HOT_TASKS = 40;
const MAX_COMMENTS_SNIP = 2;

function snip(s, n = 140) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function latestCommentText(task) {
  const list = Array.isArray(task.comments) ? task.comments : [];
  if (!list.length) return '';
  const last = list[list.length - 1];
  return snip(last?.text || '', 120);
}

function scoreRisk(task, st, dm, todayStr) {
  let score = 0;
  const end = dm?.[task.id]?.e;
  if (st === 'overdue' && end) score += 40 + Math.min(30, dbDays(end, todayStr) || 0);
  if (st === 'paused' || st === 'blocked') score += 25;
  const next = getLatestNextActionEntry(task.comments || []);
  const nad = next?.nextActionDate;
  if (nad && nad < todayStr) score += 20 + Math.min(20, dbDays(nad, todayStr) || 0);
  if (st === 'inprogress') score += 8;
  if (!task.who) score += 6;
  const breach = assessTaskCompliance(task, dm, todayStr);
  if (breach?.breaches?.length) score += 15 * breach.breaches.length;
  return score;
}

/**
 * Compact analytics snapshot for LLM + local engine.
 * @param {object[]} projects
 * @param {{ projectId?: string|null, person?: string }} [opts]
 */
export function buildAnalyticsContext(projects, opts = {}) {
  const todayStr = todayIso();
  const projectId = opts.projectId || null;
  const list = (projects || []).filter((p) => !projectId || p.id === projectId);

  const portfolio = {
    generatedAt: new Date().toISOString(),
    today: todayStr,
    scope: projectId ? 'project' : 'portfolio',
    projectId,
    projectCount: list.length,
    totals: {
      tasks: 0,
      completed: 0,
      inprogress: 0,
      overdue: 0,
      paused: 0,
      notstarted: 0,
      blocked: 0,
      unassigned: 0,
      nextActionOverdue: 0,
      complianceBreaches: 0,
    },
    projects: [],
    hotTasks: [],
    workload: [],
    phaseRollup: [],
  };

  const whoMap = new Map();

  for (const proj of list) {
    const dm = cDates(proj);
    const pStat = {
      id: proj.id,
      name: proj.name,
      loc: proj.loc || '',
      status: proj.status || '',
      floors: proj.floors || '',
      kickoff: proj.ko || '',
      phases: (proj.phases || []).length,
      tasks: 0,
      completed: 0,
      inprogress: 0,
      overdue: 0,
      paused: 0,
      notstarted: 0,
      pct: 0,
      topRisks: [],
    };

    const phaseRoll = [];

    for (const ph of proj.phases || []) {
      const phRow = {
        projectId: proj.id,
        project: proj.name,
        phaseId: ph.id,
        phase: ph.name,
        tasks: 0,
        completed: 0,
        overdue: 0,
        inprogress: 0,
      };

      for (const task of ph.tasks || []) {
        const st = taskStatus(task, dm);
        const stored = ensureTaskStatus(task);
        pStat.tasks += 1;
        phRow.tasks += 1;
        portfolio.totals.tasks += 1;

        const bucket =
          st === 'completed' || stored === 'completed'
            ? 'completed'
            : st === 'overdue'
              ? 'overdue'
              : stored === 'paused' || st === 'paused'
                ? 'paused'
                : stored === 'blocked' || st === 'blocked'
                  ? 'blocked'
                  : st === 'inprogress'
                    ? 'inprogress'
                    : 'notstarted';

        pStat[bucket] = (pStat[bucket] || 0) + 1;
        portfolio.totals[bucket] = (portfolio.totals[bucket] || 0) + 1;
        if (bucket === 'completed') phRow.completed += 1;
        if (bucket === 'overdue') phRow.overdue += 1;
        if (bucket === 'inprogress') phRow.inprogress += 1;

        if (!String(task.who || '').trim()) {
          portfolio.totals.unassigned += 1;
        } else {
          String(task.who)
            .split(/[,;/|]/)
            .map((x) => x.trim())
            .filter(Boolean)
            .forEach((w) => {
              const cur = whoMap.get(w) || { who: w, open: 0, overdue: 0, inprogress: 0 };
              if (bucket !== 'completed') cur.open += 1;
              if (bucket === 'overdue') cur.overdue += 1;
              if (bucket === 'inprogress') cur.inprogress += 1;
              whoMap.set(w, cur);
            });
        }

        const next = getLatestNextActionEntry(task.comments || []);
        if (next?.nextActionDate && next.nextActionDate < todayStr && bucket !== 'completed') {
          portfolio.totals.nextActionOverdue += 1;
        }

        const compliance = assessTaskCompliance(task, dm, todayStr);
        if (compliance?.breaches?.length) {
          portfolio.totals.complianceBreaches += 1;
        }

        if (bucket === 'completed') continue;

        const risk = scoreRisk(task, st, dm, todayStr);
        const dates = dm[task.id] || {};
        const row = {
          risk,
          projectId: proj.id,
          project: proj.name,
          phaseId: ph.id,
          phase: ph.name,
          taskId: task.id,
          task: task.name,
          parentId: taskParentId(task) || null,
          status: st,
          storedStatus: stored,
          who: task.who || '',
          plannedStart: dates.s || task.ms || '',
          plannedEnd: dates.e || '',
          daysOverdue: dates.e && st === 'overdue' ? dbDays(dates.e, todayStr) : 0,
          nextAction: next?.nextAction || '',
          nextActionDate: next?.nextActionDate || '',
          nextActionOverdueDays:
            next?.nextActionDate && next.nextActionDate < todayStr
              ? dbDays(next.nextActionDate, todayStr)
              : 0,
          complianceKinds: (compliance?.breaches || []).map((b) => b.kind),
          lastComment: latestCommentText(task),
          commentCount: (task.comments || []).length,
          recentComments: (task.comments || [])
            .slice(-MAX_COMMENTS_SNIP)
            .map((c) => ({
              author: c.author || '',
              text: snip(c.text, 100),
              nextAction: snip(c.nextAction, 80),
              nextActionDate: c.nextActionDate || '',
            })),
        };
        portfolio.hotTasks.push(row);
        pStat.topRisks.push(row);
      }

      if (phRow.tasks) phaseRoll.push(phRow);
    }

    pStat.pct = pStat.tasks ? Math.round((pStat.completed / pStat.tasks) * 100) : 0;
    pStat.topRisks = pStat.topRisks.sort((a, b) => b.risk - a.risk).slice(0, 8);
    portfolio.projects.push(pStat);
    portfolio.phaseRollup.push(...phaseRoll.sort((a, b) => b.overdue - a.overdue).slice(0, 6));
  }

  portfolio.hotTasks = portfolio.hotTasks.sort((a, b) => b.risk - a.risk).slice(0, MAX_HOT_TASKS);
  portfolio.workload = [...whoMap.values()]
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
    .slice(0, 25);
  portfolio.phaseRollup = portfolio.phaseRollup.sort((a, b) => b.overdue - a.overdue).slice(0, 20);

  return portfolio;
}

/** Tiny prompt examples for the UI. */
export const ANALYTICS_PROMPT_EXAMPLES = [
  'What are the current bottlenecks across all projects?',
  'Which project is most at risk this week and why?',
  'Predict which tasks will slip in the next 14 days.',
  'Prescribe the top 5 actions leadership should take today.',
  'Who is overloaded and what should we rebalance?',
  'Summarize compliance breaches and how to clear them.',
];
