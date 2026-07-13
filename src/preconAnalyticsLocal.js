/**
 * Deterministic local answers when LLM is unavailable or as a grounded baseline.
 * Produces informative / predictive / prescriptive sections from analytics context.
 */

function intentOf(q) {
  const s = String(q || '').toLowerCase();
  if (/\b(predict|forecast|will slip|likely|risk of delay|ahead)\b/.test(s)) return 'predictive';
  if (/\b(prescribe|recommend|should|action plan|what to do|next steps|fix)\b/.test(s)) return 'prescriptive';
  if (/\b(bottleneck|stuck|block|delay|overdue|at risk|compliance|workload|who)\b/.test(s)) return 'diagnostic';
  if (/\b(summar|overview|status|how is|health)\b/.test(s)) return 'informative';
  return 'general';
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

/**
 * @param {string} question
 * @param {object} ctx — from buildAnalyticsContext
 */
export function answerAnalyticsLocally(question, ctx) {
  const intent = intentOf(question);
  const T = ctx.totals || {};
  const hot = ctx.hotTasks || [];
  const wl = ctx.workload || [];
  const projects = ctx.projects || [];
  const worstProj = [...projects].sort((a, b) => b.overdue - a.overdue || a.pct - b.pct)[0];

  const sections = [];

  sections.push({
    kind: 'informative',
    title: 'Snapshot',
    body: [
      `Scope: **${ctx.scope === 'project' ? 'single project' : 'portfolio'}** · ${ctx.projectCount} project(s) · as of ${ctx.today}.`,
      `Tasks: **${T.tasks || 0}** · completed **${T.completed || 0}** · in progress **${T.inprogress || 0}** · overdue **${T.overdue || 0}** · paused **${T.paused || 0}** · unassigned **${T.unassigned || 0}**.`,
      `Next-action overdue: **${T.nextActionOverdue || 0}** · compliance breaches: **${T.complianceBreaches || 0}**.`,
      worstProj
        ? `Highest pressure project: **${worstProj.name}** (${worstProj.overdue} overdue, ${worstProj.pct}% complete).`
        : 'No project data in scope.',
    ].join('\n'),
  });

  if (intent === 'diagnostic' || intent === 'general' || intent === 'informative') {
    sections.push({
      kind: 'informative',
      title: 'Current bottlenecks / hotspots',
      body: hot.length
        ? top(hot, 8).map(taskLine).join('\n')
        : 'No open high-risk tasks in this scope.',
    });
  }

  if (intent === 'predictive' || intent === 'general') {
    const slip = hot.filter(
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
    if (T.overdue) actions.push(`Clear the **${T.overdue}** schedule-overdue task(s) — start with the top risk list.`);
    if (T.nextActionOverdue) {
      actions.push(`Refresh next-action dates on **${T.nextActionOverdue}** stale item(s) so My Work calendars stay honest.`);
    }
    if (T.unassigned) actions.push(`Assign owners to **${T.unassigned}** unassigned open task(s).`);
    const overloaded = top(
      wl.filter((w) => w.overdue >= 2 || w.open >= 8),
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

  if (wl.length && /\b(who|workload|overload|assignee|capacity)\b/i.test(question || '')) {
    sections.push({
      kind: 'informative',
      title: 'Workload pressure',
      body: top(wl, 10)
        .map((w) => `- **${w.who}** — open ${w.open}, overdue ${w.overdue}, in progress ${w.inprogress}`)
        .join('\n'),
    });
  }

  const markdown = [
    `### Answer (${intent})`,
    '',
    ...sections.flatMap((s) => [`#### ${s.title}`, s.body || s.narrative || '', '']),
    '_Generated from live PreConstruction data (local analytics engine)._',
  ].join('\n');

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
  if (hot.length) {
    charts.push({
      type: 'hbar',
      title: 'Top risk tasks',
      narrative: 'Relative risk pressure from overdue schedule, stale next actions, and compliance gaps.',
      data: top(hot, 8).map((t) => ({
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

  return {
    ok: true,
    source: 'local',
    intent,
    headline: worstProj
      ? `${T.overdue || 0} overdue · pressure on ${worstProj.name}`
      : `Portfolio health · ${T.overdue || 0} overdue`,
    sections: structuredSections,
    charts: charts.filter((c) => c.data?.length),
    markdown,
    highlights: {
      overdue: T.overdue || 0,
      nextActionOverdue: T.nextActionOverdue || 0,
      complianceBreaches: T.complianceBreaches || 0,
      hotCount: hot.length,
    },
    proposedActions: proposeFromHot(hot, 5),
  };
}
