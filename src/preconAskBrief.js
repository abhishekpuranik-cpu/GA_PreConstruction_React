/**
 * Fact-locked project status brief for Ask AI.
 * Every bullet is derived from live project/task/comment fields — no invented metrics.
 */

import { cDates, dbDays } from './preconDates.js';
import { collectTaskComments } from './preconComments.js';
import { getLatestNextActionEntry } from './preconMyWork.js';
import { assessTaskCompliance } from './preconCompliance.js';
import {
  currentDueIso,
  ensureTaskStatus,
  statusLabel,
  taskStatus,
  todayIso,
} from './preconTaskStatus.js';

const CHALLENGE_RE =
  /\b(block|blocker|delay|delayed|risk|issue|challenge|stuck|hold|holding|waiting|wait|pending|slip|missed|problem|constraint|hinder|approv|noc|rejection|reject|shortage|not received|no response|escalat)\b/i;

const STATUS_Q_RE =
  /\b(what('?s| is| are)?\s+happening|status|overview|summar(y|ise|ize)|health|how\s+is|how'?s|progress|update|situation|state\s+of|where\s+(are|is)\s+we|missed|timeline|challenge|next\s+steps?|this\s+week|fortnight|month)\b/i;

function snip(s, n = 180) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtShort(iso) {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getDate()} ${mon[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/** True when the question is asking for a project narrative / briefing. */
export function isProjectStatusQuestion(question) {
  return STATUS_Q_RE.test(String(question || ''));
}

/**
 * Resolve a project from UI scope and/or question text.
 * @returns {{ project?: object, ambiguous?: object[], reason?: string, confidence: 'high'|'medium'|'low' }}
 */
export function resolveProjectForAsk(question, projects, projectId = null) {
  const list = Array.isArray(projects) ? projects : [];
  if (projectId) {
    const hit = list.find((p) => p.id === projectId);
    if (hit) return { project: hit, confidence: 'high' };
    return { reason: 'Selected project is not in the current workspace.', confidence: 'low' };
  }

  if (!list.length) {
    return { reason: 'No projects loaded in PreConstruction.', confidence: 'low' };
  }

  const q = normName(question);
  if (!q) return { reason: 'Empty question.', confidence: 'low' };

  const scored = list
    .map((p) => {
      const name = normName(p.name);
      const loc = normName(p.loc);
      let score = 0;
      if (name && q.includes(name)) score += 100 + name.length;
      else if (name) {
        const parts = name.split(/\s+/).filter((t) => t.length > 2);
        const hits = parts.filter((t) => q.includes(t));
        if (hits.length) score += hits.length * 12 + hits.join('').length;
      }
      if (loc && loc.length > 3 && q.includes(loc)) score += 20;
      if (p.id && q.includes(String(p.id).toLowerCase())) score += 40;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    if (list.length === 1 && isProjectStatusQuestion(question)) {
      return { project: list[0], confidence: 'medium' };
    }
    return {
      reason:
        'Could not match a project name in your question. Select a project in the Ask AI scope dropdown, or name the project explicitly.',
      confidence: 'low',
    };
  }

  const best = scored[0];
  const runners = scored.filter((x) => x.score >= best.score * 0.85 && x.p.id !== best.p.id);
  if (runners.length && best.score < 40) {
    return {
      ambiguous: [best.p, ...runners.map((r) => r.p)].slice(0, 5),
      reason: 'Multiple projects could match. Pick one in the scope dropdown.',
      confidence: 'low',
    };
  }
  return {
    project: best.p,
    confidence: best.score >= 40 ? 'high' : 'medium',
  };
}

function isChallengeComment(c) {
  if (!c) return false;
  if (c.flag) return true;
  const blob = `${c.text || ''} ${c.nextAction || ''}`;
  return CHALLENGE_RE.test(blob);
}

function workDateForTask(task, dm, st) {
  if (st === 'completed') return null;
  return currentDueIso(task, dm) || dm?.[task.id]?.e || null;
}

/**
 * Build a deterministic brief from one live project object.
 */
export function buildProjectBrief(proj, { todayStr = todayIso() } = {}) {
  const dm = cDates(proj);
  const phases = [];
  const missed = [];
  const challenges = [];
  const horizons = { week: [], fortnight: [], month: [] };
  const weekEnd = addDaysIso(todayStr, 7);
  const fortnightEnd = addDaysIso(todayStr, 14);
  const monthEnd = addDaysIso(todayStr, 30);

  let totals = {
    tasks: 0,
    completed: 0,
    inprogress: 0,
    overdue: 0,
    paused: 0,
    notstarted: 0,
    unassigned: 0,
    nextActionOverdue: 0,
    complianceBreaches: 0,
  };

  for (const ph of proj.phases || []) {
    const phRow = {
      id: ph.id,
      name: ph.name,
      tasks: 0,
      completed: 0,
      overdue: 0,
      inprogress: 0,
      open: 0,
    };

    for (const task of ph.tasks || []) {
      const st = taskStatus(task, dm);
      const stored = ensureTaskStatus(task);
      const dates = dm[task.id] || {};
      const comments = collectTaskComments(proj, ph, task);
      const next = getLatestNextActionEntry(comments);
      const due = workDateForTask(task, dm, st);
      const compliance = assessTaskCompliance(task, dm, todayStr);

      totals.tasks += 1;
      phRow.tasks += 1;

      if (st === 'completed' || stored === 'completed') {
        totals.completed += 1;
        phRow.completed += 1;
      } else if (st === 'overdue') {
        totals.overdue += 1;
        phRow.overdue += 1;
        phRow.open += 1;
      } else if (st === 'paused' || stored === 'paused') {
        totals.paused += 1;
        phRow.open += 1;
      } else if (st === 'inprogress') {
        totals.inprogress += 1;
        phRow.inprogress += 1;
        phRow.open += 1;
      } else {
        totals.notstarted += 1;
        phRow.open += 1;
      }

      if (st !== 'completed' && !String(task.who || '').trim()) totals.unassigned += 1;
      if (next?.nextActionDate && next.nextActionDate < todayStr && st !== 'completed') {
        totals.nextActionOverdue += 1;
      }
      if (compliance?.breaches?.length) totals.complianceBreaches += 1;

      if (st === 'overdue' || (next?.nextActionDate && next.nextActionDate < todayStr && st !== 'completed')) {
        missed.push({
          taskId: task.id,
          phaseId: ph.id,
          phase: ph.name,
          task: task.name,
          who: task.who || '',
          status: st,
          plannedEnd: dates.e || '',
          daysScheduleOverdue: dates.e && st === 'overdue' ? dbDays(dates.e, todayStr) : 0,
          nextAction: next?.nextAction || '',
          nextActionDate: next?.nextActionDate || '',
          daysNextActionOverdue:
            next?.nextActionDate && next.nextActionDate < todayStr
              ? dbDays(next.nextActionDate, todayStr)
              : 0,
          evidence: `task:${task.id}`,
        });
      }

      if (st !== 'completed') {
        const challengeRows = comments.filter(isChallengeComment).slice(-4);
        for (const c of challengeRows) {
          challenges.push({
            taskId: task.id,
            phaseId: ph.id,
            phase: ph.name,
            task: task.name,
            who: task.who || '',
            author: c.author || '',
            ts: c.ts || c.createdAt || '',
            text: snip(c.text, 220),
            nextAction: snip(c.nextAction, 120),
            nextActionDate: c.nextActionDate || '',
            flagged: !!c.flag,
            evidence: `comment:${task.id}:${c.createdAt || c.ts || snip(c.text, 40)}`,
          });
        }
      }

      if (st === 'completed' || !due) continue;
      const item = {
        taskId: task.id,
        phaseId: ph.id,
        phase: ph.name,
        task: task.name,
        who: task.who || '',
        status: st,
        dueDate: due,
        dueSource: next?.nextActionDate ? 'next_action' : 'planned_end',
        nextAction: next?.nextAction || '',
        plannedEnd: dates.e || '',
        evidence: `task:${task.id}`,
      };
      if (due >= todayStr && weekEnd && due <= weekEnd) horizons.week.push(item);
      if (due >= todayStr && fortnightEnd && due <= fortnightEnd) horizons.fortnight.push(item);
      if (due >= todayStr && monthEnd && due <= monthEnd) horizons.month.push(item);
    }

    if (phRow.tasks) phases.push(phRow);
  }

  const sortMissed = (a, b) =>
    (b.daysScheduleOverdue || 0) - (a.daysScheduleOverdue || 0) ||
    (b.daysNextActionOverdue || 0) - (a.daysNextActionOverdue || 0);
  const sortHorizon = (a, b) => String(a.dueDate).localeCompare(String(b.dueDate));

  missed.sort(sortMissed);
  horizons.week.sort(sortHorizon);
  horizons.fortnight.sort(sortHorizon);
  horizons.month.sort(sortHorizon);

  // Deduplicate challenges by text+task (keep newest-ish order as collected)
  const seenCh = new Set();
  const uniqChallenges = [];
  for (const c of challenges.reverse()) {
    const key = `${c.taskId}|${normName(c.text).slice(0, 80)}`;
    if (seenCh.has(key)) continue;
    seenCh.add(key);
    uniqChallenges.push(c);
    if (uniqChallenges.length >= 18) break;
  }
  uniqChallenges.reverse();

  const pct = totals.tasks ? Math.round((totals.completed / totals.tasks) * 100) : 0;

  return {
    generatedAt: new Date().toISOString(),
    today: todayStr,
    project: {
      id: proj.id,
      name: proj.name,
      loc: proj.loc || '',
      status: proj.status || '',
      floors: proj.floors || '',
      kickoff: proj.ko || '',
      phaseCount: (proj.phases || []).length,
    },
    totals: { ...totals, pct },
    phases: phases.sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    missed: missed.slice(0, 25),
    challenges: uniqChallenges,
    horizons: {
      week: horizons.week.slice(0, 20),
      fortnight: horizons.fortnight.slice(0, 25),
      month: horizons.month.slice(0, 40),
    },
    evidence: {
      kind: 'project_brief',
      projectId: proj.id,
      counts: {
        missed: missed.length,
        challenges: uniqChallenges.length,
        week: horizons.week.length,
        fortnight: horizons.fortnight.length,
        month: horizons.month.length,
      },
    },
  };
}

function lineMissed(m) {
  const bits = [`**${m.task}** (${m.phase})`, `status ${statusLabel(m.status)}`];
  if (m.who) bits.push(`owner ${m.who}`);
  else bits.push('unassigned');
  if (m.daysScheduleOverdue) bits.push(`schedule overdue ${m.daysScheduleOverdue}d (end ${fmtShort(m.plannedEnd)})`);
  if (m.daysNextActionOverdue) {
    bits.push(`next-action overdue ${m.daysNextActionOverdue}d (${fmtShort(m.nextActionDate)})`);
  }
  if (m.nextAction) bits.push(`next: ${snip(m.nextAction, 90)}`);
  return `- ${bits.join(' · ')}`;
}

function lineHorizon(h) {
  const bits = [
    `**${h.task}** (${h.phase})`,
    `due ${fmtShort(h.dueDate)} (${h.dueSource === 'next_action' ? 'next action' : 'schedule end'})`,
  ];
  if (h.who) bits.push(`owner ${h.who}`);
  else bits.push('unassigned');
  if (h.nextAction) bits.push(`step: ${snip(h.nextAction, 100)}`);
  else bits.push(`status ${statusLabel(h.status)}`);
  return `- ${bits.join(' · ')}`;
}

function lineChallenge(c) {
  const who = c.author ? `_${c.author}_` : '_unknown author_';
  const when = c.ts ? ` · ${c.ts}` : '';
  const next = c.nextAction ? ` → Next: ${c.nextAction}${c.nextActionDate ? ` (${fmtShort(c.nextActionDate)})` : ''}` : '';
  return `- **${c.task}** (${c.phase}): ${who}${when} — “${c.text || '(no text)'}”${next}`;
}

/**
 * Format brief into Ask AI answer shape. Facts only — lockFacts prevents LLM override of numbers.
 */
export function formatProjectBriefAnswer(question, brief, { confidence = 'high' } = {}) {
  const p = brief.project;
  const T = brief.totals;
  const q = String(question || '').trim();

  const stateLines = [
    `**${p.name}**${p.loc ? ` · ${p.loc}` : ''}${p.status ? ` · status “${p.status}”` : ''}.`,
    `Kickoff: **${p.kickoff ? fmtShort(p.kickoff) : 'not set'}**${p.floors ? ` · floors ${p.floors}` : ''} · **${p.phaseCount}** phase(s).`,
    `Progress: **${T.pct}%** complete (**${T.completed}** / **${T.tasks}** tasks) · in progress **${T.inprogress}** · overdue **${T.overdue}** · paused **${T.paused}** · not started **${T.notstarted}** · unassigned open **${T.unassigned}**.`,
    `Process pressure: next-action overdue **${T.nextActionOverdue}** · compliance breaches **${T.complianceBreaches}**.`,
    '',
    '**Phase snapshot (open pressure first):**',
    ...(brief.phases.length
      ? brief.phases.slice(0, 12).map(
          (ph) =>
            `- **${ph.name}**: ${ph.completed}/${ph.tasks} done · overdue **${ph.overdue}** · in progress **${ph.inprogress}** · open **${ph.open}**`,
        )
      : ['- No phases recorded.']),
  ];

  const missedLines = brief.missed.length
    ? [
        `**${brief.missed.length}** open item(s) with a missed schedule end and/or missed next-action date (from live task data):`,
        ...brief.missed.slice(0, 15).map(lineMissed),
        brief.missed.length > 15 ? `_…and ${brief.missed.length - 15} more in the data model._` : '',
      ].filter(Boolean)
    : ['No open tasks currently show a missed schedule end or missed next-action date.'];

  const challengeLines = brief.challenges.length
    ? [
        `**${brief.challenges.length}** comment(s) mentioning blockers, delays, risks, waits, or approvals (quoted from the record — not interpreted beyond the text):`,
        ...brief.challenges.slice(0, 12).map(lineChallenge),
        brief.challenges.length > 12 ? `_…and ${brief.challenges.length - 12} more challenge comments._` : '',
      ].filter(Boolean)
    : [
        'No challenge-language comments found on open tasks (keywords such as block, delay, risk, waiting, approval). This does not mean there are no issues — only that none were written in comments with those signals.',
      ];

  const horizonBlock = (label, rows, days) => {
    if (!rows.length) {
      return [
        `**${label} (next ${days} days):** No open tasks with a current due/next-action date in this window.`,
      ];
    }
    return [
      `**${label} (next ${days} days):** **${rows.length}** due item(s) — dates from next-action when set, else schedule end:`,
      ...rows.slice(0, 12).map(lineHorizon),
      rows.length > 12 ? `_…and ${rows.length - 12} more._` : '',
    ].filter(Boolean);
  };

  const sections = [
    { kind: 'informative', title: 'Project state (live data)', narrative: stateLines.join('\n') },
    { kind: 'diagnostic', title: 'Missed timelines', narrative: missedLines.join('\n') },
    { kind: 'diagnostic', title: 'Challenges mentioned in comments', narrative: challengeLines.join('\n') },
    {
      kind: 'prescriptive',
      title: 'Next steps — week / fortnight / month',
      narrative: [
        ...horizonBlock('This week', brief.horizons.week, 7),
        '',
        ...horizonBlock('Fortnight', brief.horizons.fortnight, 14),
        '',
        ...horizonBlock('Month', brief.horizons.month, 30),
      ].join('\n'),
    },
  ];

  const headline = `${p.name}: ${T.pct}% complete · ${T.overdue} overdue · ${brief.missed.length} missed-date item(s) · ${brief.horizons.week.length} due this week`;

  const markdown = [
    `### Project brief: ${p.name}`,
    '',
    `*As of ${brief.today} · sourced only from PreConstruction tasks, schedule dates, and comments · confidence ${confidence}*`,
    '',
    `**Question:** ${q.slice(0, 220)}`,
    '',
    ...sections.flatMap((s) => [`#### ${s.title}`, s.narrative, '']),
    '---',
    '_Numbers and quotes above are computed from the live project record. Ask AI will not invent missing dates, owners, or comments._',
  ].join('\n');

  const charts = [
    {
      type: 'donut',
      title: `${p.name} — status mix`,
      narrative: 'Task counts from the live schedule status engine (overdue includes next-action overdue when that is the current due).',
      data: [
        { label: 'Completed', value: T.completed },
        { label: 'In progress', value: T.inprogress },
        { label: 'Overdue', value: T.overdue },
        { label: 'Not started', value: T.notstarted },
        { label: 'Paused', value: T.paused },
      ].filter((d) => d.value > 0),
    },
    {
      type: 'hbar',
      title: 'Horizon load (due counts)',
      narrative: 'Open items with a current due date inside each window (next-action date wins over schedule end).',
      data: [
        { label: 'Week', value: brief.horizons.week.length },
        { label: 'Fortnight', value: brief.horizons.fortnight.length },
        { label: 'Month', value: brief.horizons.month.length },
        { label: 'Missed', value: brief.missed.length },
      ],
    },
  ];

  const proposedActions = brief.missed.slice(0, 5).map((m) => ({
    type: 'openProject',
    label: `Open: ${m.task}`,
    rationale: m.daysScheduleOverdue
      ? `Schedule overdue ${m.daysScheduleOverdue}d`
      : `Next action overdue ${m.daysNextActionOverdue}d`,
    projId: brief.project.id,
    phId: m.phaseId,
    tId: m.taskId,
  }));

  return {
    ok: true,
    source: 'local',
    intent: 'project_brief',
    lockFacts: true,
    confidence,
    headline,
    sections,
    charts: charts.filter((c) => c.data?.length),
    markdown,
    highlights: {
      overdue: T.overdue,
      nextActionOverdue: T.nextActionOverdue,
      complianceBreaches: T.complianceBreaches,
      missed: brief.missed.length,
      challenges: brief.challenges.length,
      dueWeek: brief.horizons.week.length,
      dueFortnight: brief.horizons.fortnight.length,
      dueMonth: brief.horizons.month.length,
      pct: T.pct,
    },
    proposedActions,
    evidence: brief,
    projectBrief: brief,
  };
}

function formatAmbiguousOrRefuse(resolution) {
  const names = (resolution.ambiguous || []).map((p) => p.name).filter(Boolean);
  const body = resolution.reason
    || (names.length
      ? `Multiple matches: ${names.map((n) => `**${n}**`).join(', ')}. Select one project in the Ask AI dropdown.`
      : 'Could not resolve a project.');
  return {
    ok: true,
    source: 'local',
    intent: 'project_brief',
    lockFacts: true,
    confidence: 'low',
    headline: 'Need a specific project to brief',
    sections: [{ kind: 'informative', title: 'Cannot brief yet', narrative: body }],
    charts: [],
    markdown: `### Project brief\n\n${body}\n\n_No numbers invented — pick a project scope first._`,
    highlights: {},
    proposedActions: (resolution.ambiguous || []).slice(0, 5).map((p) => ({
      type: 'openProject',
      label: `Open ${p.name}`,
      rationale: 'Disambiguate project for briefing',
      projId: p.id,
    })),
    evidence: { kind: 'refuse', reason: body },
  };
}

/**
 * Entry: try to answer a project-status question with a fact-locked brief.
 * Returns null when the question should fall through to the generic analytics engine.
 */
export function tryAnswerProjectStatusQuestion(question, projects, { projectId = null } = {}) {
  const q = String(question || '').trim();
  if (!q) return null;

  const scoped = !!projectId;
  const statusQ = isProjectStatusQuestion(q);
  if (!scoped && !statusQ) return null;

  // If scoped but question is unrelated (pure count of something else), still allow brief
  // when they ask status-like OR when scope is set and question is general enough.
  const resolution = resolveProjectForAsk(q, projects, projectId);
  if (resolution.ambiguous?.length || (resolution.reason && !resolution.project)) {
    if (statusQ || scoped) return formatAmbiguousOrRefuse(resolution);
    return null;
  }
  if (!resolution.project) return null;

  // Scoped project + non-status question: only take over for status-like or empty-ish overview asks
  if (scoped && !statusQ) {
    // Still brief when they pick a project and ask anything overview-like, or short "update"
    if (!/\b(bottleneck|workload|who is|how many|count|prescribe|predict)\b/i.test(q)) {
      // if it's a short ask with project selected, brief is the right default
      if (q.length > 120 && !/\b(happen|status|update|progress|timeline|challenge|next)\b/i.test(q)) {
        return null;
      }
    } else {
      return null;
    }
  }

  const brief = buildProjectBrief(resolution.project);
  return formatProjectBriefAnswer(q, brief, { confidence: resolution.confidence || 'high' });
}
