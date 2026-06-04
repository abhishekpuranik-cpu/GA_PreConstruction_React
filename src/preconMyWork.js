import { cDates, dbDays } from './preconDates.js';
import { taskStatus, todayIso } from './preconTaskStatus.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatShortDate(isoStr) {
  if (!isoStr) return '—';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${dt.getDate()} ${MON[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`;
}

function parseCommentTs(c) {
  const raw = c?.ts || '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Latest comment that defines next action + date (most recent by comment timestamp). */
export function getLatestNextAction(comments) {
  let best = null;
  let bestScore = -1;
  for (const c of comments || []) {
    const date = String(c.nextActionDate || '').trim();
    if (!date) continue;
    const score = parseCommentTs(c);
    if (score >= bestScore) {
      bestScore = score;
      best = {
        nextAction: String(c.nextAction || '').trim(),
        nextActionDate: date,
        commentSnippet: String(c.text || '').trim(),
        author: c.author || '',
      };
    }
  }
  return best;
}

/** Match task assignee to selected person (name or email fragment). */
export function assigneeMatches(taskWho, person) {
  const w = String(taskWho || '').trim().toLowerCase();
  const p = String(person || '').trim().toLowerCase();
  if (!p || p === 'user' || !w) return false;
  if (w === p) return true;
  const wParts = w.split(/\s+/);
  const pParts = p.split(/\s+/);
  if (wParts.some((x) => x && p.includes(x))) return true;
  if (pParts.some((x) => x.length > 2 && w.includes(x))) return true;
  return false;
}

function pickSortMeta(task, dm, st) {
  const next = getLatestNextAction(task.comments);
  if (next?.nextActionDate && st !== 'completed') {
    return {
      sortDate: next.nextActionDate,
      sortSource: 'next_action',
      nextAction: next,
      label: 'Next action',
    };
  }
  const d = dm[task.id];
  if (d?.e && st !== 'completed') {
    return {
      sortDate: d.e,
      sortSource: 'planned_end',
      nextAction: next,
      label: 'Planned end',
    };
  }
  if (d?.s) {
    return {
      sortDate: d.s,
      sortSource: 'planned_start',
      nextAction: next,
      label: 'Planned start',
    };
  }
  return {
    sortDate: null,
    sortSource: 'none',
    nextAction: next,
    label: 'No date',
  };
}

export function buildMyWorkItems(projects, assigneeFilter) {
  const person = String(assigneeFilter || '').trim();
  const todayStr = todayIso();
  const items = [];

  for (const proj of projects || []) {
    const dm = cDates(proj);
    for (const ph of proj.phases || []) {
      for (const task of ph.tasks || []) {
        if (!assigneeMatches(task.who, person)) continue;
        const st = taskStatus(task, dm);
        const d = dm[task.id] || { s: '', e: '' };
        const meta = pickSortMeta(task, dm, st);
        const sortTs = meta.sortDate ? new Date(meta.sortDate).getTime() : 9e15;
        const overdueDays =
          meta.sortDate && st !== 'completed' && meta.sortDate < todayStr
            ? dbDays(meta.sortDate, todayStr)
            : st === 'overdue' && d.e
              ? dbDays(d.e, todayStr)
              : 0;

        items.push({
          proj,
          ph,
          task,
          st,
          d,
          ...meta,
          sortTs: Number.isNaN(sortTs) ? 9e15 : sortTs,
          overdueDays,
          todayStr,
        });
      }
    }
  }

  items.sort((a, b) => {
    const aDone = a.st === 'completed' ? 1 : 0;
    const bDone = b.st === 'completed' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
    return (a.proj.name || '').localeCompare(b.proj.name || '');
  });

  return { items, todayStr };
}

export function groupMyWorkItems(items, todayStr) {
  const groups = [
    { id: 'overdue', title: 'Overdue', hint: 'Past due — act now', items: [] },
    { id: 'today', title: 'Today', hint: todayStr, items: [] },
    { id: 'week', title: 'Next 7 days', hint: 'Coming up soon', items: [] },
    { id: 'later', title: 'Later', hint: 'Scheduled ahead', items: [] },
    { id: 'nodate', title: 'No date set', hint: 'Add next action when you comment', items: [] },
    { id: 'done', title: 'Completed', hint: 'Closed tasks', items: [] },
  ];
  const map = Object.fromEntries(groups.map((g) => [g.id, g]));

  for (const it of items) {
    if (it.st === 'completed') {
      map.done.items.push(it);
      continue;
    }
    if (!it.sortDate || it.sortSource === 'none') {
      map.nodate.items.push(it);
      continue;
    }
    const diff = dbDays(it.sortDate, todayStr);
    if (diff < 0) map.overdue.items.push(it);
    else if (diff === 0) map.today.items.push(it);
    else if (diff <= 7) map.week.items.push(it);
    else map.later.items.push(it);
  }

  return groups.filter((g) => g.items.length > 0);
}

export function myWorkSummary(items, todayStr) {
  const open = items.filter((i) => i.st !== 'completed');
  const overdue = open.filter((i) => i.sortDate && i.sortDate < todayStr);
  const dueToday = open.filter((i) => i.sortDate === todayStr);
  const dueWeek = open.filter((i) => {
    if (!i.sortDate) return false;
    const diff = dbDays(i.sortDate, todayStr);
    return diff >= 0 && diff <= 7;
  });
  const projects = new Set(open.map((i) => i.proj.id));
  return {
    total: open.length,
    overdue: overdue.length,
    today: dueToday.length,
    week: dueWeek.length,
    projects: projects.size,
    completed: items.length - open.length,
  };
}
