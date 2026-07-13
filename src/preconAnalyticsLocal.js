/**
 * Deterministic local answers when LLM is unavailable or as a grounded baseline.
 * Answers the user's question from analytics context — not a generic template.
 */

function intentOf(q) {
  const s = String(q || '').toLowerCase();
  if (/\b(predict|forecast|will slip|likely|risk of delay|ahead)\b/.test(s)) return 'predictive';
  if (/\b(prescribe|recommend|should|action plan|what to do|next steps|fix|prioriti[sz]e)\b/.test(s)) {
    return 'prescriptive';
  }
  if (/\b(bottleneck|stuck|block|delay|overdue|at risk|compliance|workload|who|which)\b/.test(s)) {
    return 'diagnostic';
  }
  if (/\b(how many|count|total|number of)\b/.test(s)) return 'count';
  if (/\b(summar|overview|status|how is|health)\b/.test(s)) return 'informative';
  return 'general';
}

const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'what', 'which',
  'who', 'how', 'many', 'show', 'tell', 'list', 'about', 'please', 'task', 'tasks', 'project',
  'projects', 'preconstruction', 'this', 'that', 'with', 'from', 'should', 'will', 'next',
]);

function tokensOf(q) {
  return String(q || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9._-]{1,}/g)
    ?.filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t)) || [];
}

function hay(obj) {
  try {
    return JSON.stringify(obj || {}).toLowerCase();
  } catch {
    return '';
  }
}

function score(obj, tokens) {
  if (!tokens.length) return 0;
  const h = hay(obj);
  let s = 0;
  for (const t of tokens) {
    if (h.includes(t)) s += t.length >= 5 ? 3 : 2;
  }
  return s;
}

function top(list, n = 5) {
  return (list || []).slice(0, n);
}

function taskLine(t) {
  const bits = [
    `**${t.task}** (${t.project} · ${t.phase})`,
    `status ${t.status}`,
    t.who ? `owner ${t.who}` : 'unassigned',
  ];
  if (t.daysOverdue) bits.push(`${t.daysOverdue}d schedule overdue`);
  if (t.nextActionOverdueDays) bits.push(`next action overdue ${t.nextActionOverdueDays}d`);
  if (t.nextAction) bits.push(`next: ${t.nextAction}`);
  return `- ${bits.join(' · ')}`;
}

function proposeFromHot(hot, limit = 5) {
  return top(hot, limit).map((t) => {
    if (t.status === 'overdue' || t.nextActionOverdueDays > 0) {
      return {
        type: 'setTaskStatus',
        label: `Review / unblock: ${t.task}`,
        rationale: t.daysOverdue
          ? `Schedule overdue ${t.daysOverdue} days`
          : `Next action overdue ${t.nextActionOverdueDays} days`,
        projId: t.projectId,
        phId: t.phaseId,
        tId: t.taskId,
        fields: { status: 'inprogress' },
        openProject: true,
      };
    }
    if (!t.who) {
      return {
        type: 'openProject',
        label: `Assign owner: ${t.task}`,
        rationale: 'Unassigned open task',
        projId: t.projectId,
        phId: t.phaseId,
        tId: t.taskId,
      };
    }
    return {
      type: 'openProject',
      label: `Inspect: ${t.task}`,
      rationale: `Risk score ${t.risk}`,
      projId: t.projectId,
      phId: t.phaseId,
      tId: t.taskId,
    };
  });
}

function filterByQuery(list, tokens) {
  if (!tokens.length) return { matched: [], fallback: list || [] };
  const ranked = (list || [])
    .map((row) => ({ row, s: score(row, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.row.risk || 0) - (a.row.risk || 0));
  return {
    matched: ranked.map((x) => x.row),
    fallback: list || [],
  };
}

/**
 * @param {string} question
 * @param {object} ctx — from buildAnalyticsContext
 */
export function answerAnalyticsLocally(question, ctx) {
  const q = String(question || '').trim();
  const intent = intentOf(q);
  const tokens = tokensOf(q);
  const T = ctx.totals || {};
  const hot = ctx.hotTasks || [];
  const wl = ctx.workload || [];
  const projects = ctx.projects || [];
  const phases = ctx.phaseRollup || [];

  const taskHit = filterByQuery(hot, tokens);
  const projHit = filterByQuery(projects, tokens);
  const whoHit = filterByQuery(wl, tokens);
  const phaseHit = filterByQuery(phases, tokens);

  const usedFallback =
    tokens.length > 0 &&
    !taskHit.matched.length &&
    !projHit.matched.length &&
    !whoHit.matched.length &&
    !phaseHit.matched.length;

  const focusTasks = taskHit.matched.length ? taskHit.matched : usedFallback ? [] : top(hot, 8);
  const focusProjects = projHit.matched.length
    ? projHit.matched
    : [...projects].sort((a, b) => b.overdue - a.overdue || a.pct - b.pct);
  const worstProj = focusProjects[0];
  const focusWho = whoHit.matched.length ? whoHit.matched : wl;

  const sections = [];
  const direct = [];

  // Direct answer tailored to the question
  if (intent === 'count') {
    if (/\boverdue\b/i.test(q)) {
      direct.push(`**Direct answer:** There are **${T.overdue || 0}** schedule-overdue task(s) in scope.`);
    } else if (/\bunassigned\b/i.test(q)) {
      direct.push(`**Direct answer:** There are **${T.unassigned || 0}** unassigned open task(s).`);
    } else if (/\bcompliance\b/i.test(q)) {
      direct.push(`**Direct answer:** There are **${T.complianceBreaches || 0}** compliance breach(es).`);
    } else if (/\bproject\b/i.test(q)) {
      direct.push(`**Direct answer:** Scope covers **${ctx.projectCount || 0}** project(s).`);
    } else if (taskHit.matched.length) {
      direct.push(`**Direct answer:** **${taskHit.matched.length}** hot task(s) match your question terms.`);
    } else {
      direct.push(
        `**Direct answer:** Tasks **${T.tasks || 0}** · overdue **${T.overdue || 0}** · next-action overdue **${T.nextActionOverdue || 0}** · unassigned **${T.unassigned || 0}**.`,
      );
    }
  } else if (whoHit.matched.length) {
    const w = whoHit.matched[0];
    direct.push(
      `**Direct answer:** **${w.who}** has **${w.open}** open / **${w.overdue}** overdue / **${w.inprogress}** in progress.`,
    );
  } else if (projHit.matched.length) {
    const p = projHit.matched[0];
    direct.push(
      `**Direct answer:** **${p.name}** is **${p.pct}%** complete with **${p.overdue}** overdue of **${p.tasks}** tasks.`,
    );
  } else if (taskHit.matched.length) {
    const t = taskHit.matched[0];
    direct.push(
      `**Direct answer:** Top match is **${t.task}** on **${t.project}** (${t.status}${t.who ? `, owner ${t.who}` : ', unassigned'}).`,
    );
  } else if (/\boverdue\b/i.test(q)) {
    direct.push(
      `**Direct answer:** **${T.overdue || 0}** schedule-overdue and **${T.nextActionOverdue || 0}** next-action overdue in the current scope.`,
    );
  } else if (worstProj) {
    direct.push(
      `**Direct answer:** Highest pressure is **${worstProj.name}** (${worstProj.overdue} overdue, ${worstProj.pct}% complete). Portfolio overdue: **${T.overdue || 0}**.`,
    );
  } else {
    direct.push('**Direct answer:** No projects/tasks in the current filter scope.');
  }

  if (usedFallback) {
    direct.push(
      `_No exact name matches for (${tokens.slice(0, 6).join(', ')}); using portfolio pressure signals instead._`,
    );
  }

  sections.push({
    kind: 'informative',
    title: 'Answer to your question',
    body: direct.join('\n'),
  });

  sections.push({
    kind: 'informative',
    title: 'Snapshot',
    body: [
      `Scope: **${ctx.scope === 'project' ? 'single project' : 'portfolio'}** · ${ctx.projectCount} project(s) · as of ${ctx.today}.`,
      `Tasks: **${T.tasks || 0}** · completed **${T.completed || 0}** · in progress **${T.inprogress || 0}** · overdue **${T.overdue || 0}** · paused **${T.paused || 0}** · unassigned **${T.unassigned || 0}**.`,
      `Next-action overdue: **${T.nextActionOverdue || 0}** · compliance breaches: **${T.complianceBreaches || 0}**.`,
    ].join('\n'),
  });

  const evidenceTasks = focusTasks.length ? focusTasks : top(hot, 8);
  if (evidenceTasks.length && (intent === 'diagnostic' || intent === 'general' || intent === 'informative' || intent === 'count' || taskHit.matched.length)) {
    sections.push({
      kind: 'informative',
      title: taskHit.matched.length ? 'Tasks matching your question' : 'Current bottlenecks / hotspots',
      body: top(evidenceTasks, 8).map(taskLine).join('\n'),
    });
  }

  if (intent === 'predictive' || intent === 'general') {
    const slip = (focusTasks.length ? focusTasks : hot).filter(
      (t) =>
        t.status === 'overdue' ||
        t.nextActionOverdueDays > 0 ||
        (t.status === 'inprogress' && t.complianceKinds?.length) ||
        (!t.who && t.status !== 'completed'),
    );
    sections.push({
      kind: 'predictive',
      title: 'Likely to slip (next 7–14 days)',
      body: slip.length
        ? [
            'Based on overdue schedule, stale next actions, compliance gaps, and missing owners:',
            ...top(slip, 7).map(taskLine),
            '',
            'These are the highest probability delays unless dates are extended or blockers cleared.',
          ].join('\n')
        : 'No strong slip signals in the current open set.',
    });
  }

  if (intent === 'prescriptive' || intent === 'general' || intent === 'diagnostic') {
    const actions = [];
    if (taskHit.matched.length) {
      actions.push(`Start with matched task **${taskHit.matched[0].task}** on **${taskHit.matched[0].project}**.`);
    }
    if (T.overdue) actions.push(`Clear the **${T.overdue}** schedule-overdue task(s) — start with the top risk list.`);
    if (T.nextActionOverdue) {
      actions.push(`Refresh next-action dates on **${T.nextActionOverdue}** stale item(s) so My Work calendars stay honest.`);
    }
    if (T.unassigned) actions.push(`Assign owners to **${T.unassigned}** unassigned open task(s).`);
    const overloaded = top(
      focusWho.filter((w) => w.overdue >= 2 || w.open >= 8),
      3,
    );
    if (overloaded.length) {
      actions.push(
        `Rebalance load: ${overloaded.map((w) => `${w.who} (${w.open} open / ${w.overdue} overdue)`).join('; ')}.`,
      );
    }
    if (worstProj?.overdue) {
      actions.push(`Run a focused recovery huddle on **${worstProj.name}** this week.`);
    }
    if (!actions.length) actions.push('Maintain cadence: keep next-action dates current and watch in-progress aging.');

    sections.push({
      kind: 'prescriptive',
      title: 'Recommended actions',
      body: actions.map((a, i) => `${i + 1}. ${a}`).join('\n'),
    });
  }

  if (focusWho.length && (whoHit.matched.length || /\b(who|workload|overload|assignee|capacity)\b/i.test(q))) {
    sections.push({
      kind: 'informative',
      title: whoHit.matched.length ? 'People matching your question' : 'Workload pressure',
      body: top(focusWho, 10)
        .map((w) => `- **${w.who}** — open ${w.open}, overdue ${w.overdue}, in progress ${w.inprogress}`)
        .join('\n'),
    });
  }

  const markdown = [
    `### Answer to: “${q.slice(0, 180)}”`,
    '',
    ...sections.flatMap((s) => [`#### ${s.title}`, s.body || s.narrative || '', '']),
    `_Generated from live PreConstruction data (local query engine · intent=${intent})._`,
  ].join('\n');

  const chartTasks = evidenceTasks.length ? evidenceTasks : hot;
  const charts = [];
  charts.push({
    type: 'donut',
    title: 'Task status mix',
    narrative: 'Share of completed vs in-progress vs overdue vs other open work in the current scope.',
    data: [
      { label: 'Completed', value: T.completed || 0 },
      { label: 'In progress', value: T.inprogress || 0 },
      { label: 'Overdue', value: T.overdue || 0 },
      { label: 'Not started', value: T.notstarted || 0 },
      { label: 'Paused', value: T.paused || 0 },
    ].filter((d) => d.value > 0),
  });
  if (chartTasks.length) {
    charts.push({
      type: 'hbar',
      title: taskHit.matched.length ? 'Matched tasks (risk)' : 'Top risk tasks',
      narrative: taskHit.matched.length
        ? 'Tasks that matched your question, ranked by risk pressure.'
        : 'Relative risk pressure from overdue schedule, stale next actions, and compliance gaps.',
      data: top(chartTasks, 8).map((t) => ({
        label: String(t.task || '').slice(0, 18),
        value: t.risk || 1,
      })),
    });
  }

  const structuredSections = sections.map((s) => ({
    kind: s.kind,
    title: s.title,
    narrative: s.body || s.narrative || '',
  }));

  const headline = taskHit.matched.length
    ? `${taskHit.matched.length} match(es): ${taskHit.matched[0].task}`
    : whoHit.matched.length
      ? `${whoHit.matched[0].who}: ${whoHit.matched[0].open} open / ${whoHit.matched[0].overdue} overdue`
      : projHit.matched.length
        ? `${projHit.matched[0].name}: ${projHit.matched[0].overdue} overdue · ${projHit.matched[0].pct}%`
        : worstProj
          ? `${T.overdue || 0} overdue · pressure on ${worstProj.name}`
          : `Portfolio health · ${T.overdue || 0} overdue`;

  return {
    ok: true,
    source: 'local',
    intent,
    headline,
    sections: structuredSections,
    charts: charts.filter((c) => c.data?.length),
    markdown,
    highlights: {
      overdue: T.overdue || 0,
      nextActionOverdue: T.nextActionOverdue || 0,
      complianceBreaches: T.complianceBreaches || 0,
      matchedTasks: taskHit.matched.length,
      hotCount: hot.length,
    },
    proposedActions: proposeFromHot(evidenceTasks.length ? evidenceTasks : hot, 5),
    queryTokens: tokens,
  };
}
