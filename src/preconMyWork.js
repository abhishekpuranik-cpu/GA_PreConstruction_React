import { cDates, dbDays } from './preconDates.js';
import { taskMatchesStatusFilters, taskStatus, todayIso } from './preconTaskStatus.js';
import { getDepartmentForPhase } from './preconDepartments.js';
import { assigneeMatches, nameMatches } from './preconAssignees.js';
import { commentSortKey } from './preconComments.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatShortDate(isoStr) {
  if (!isoStr) return '—';
  const dt = new Date(isoStr);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${dt.getDate()} ${MON[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}`;
}

function parseCommentTs(c) {
  return commentSortKey(c);
}

/** Earliest of next-action date and planned task end (for open tasks). */
export function effectiveChronologyDate(task, dm, st) {
  const next = getLatestNextActionEntry(task.comments);
  const na = next?.nextActionDate;
  const end = st !== 'completed' ? dm[task.id]?.e : null;
  const candidates = [];
  if (na) candidates.push(String(na).trim());
  if (end) candidates.push(String(end).trim());
  const valid = candidates.filter((d) => d && !Number.isNaN(new Date(d).getTime()));
  if (!valid.length) return { sortDate: null, nextDate: na || null, dueDate: end || null };
  valid.sort();
  const sortDate = valid[0];
  const source =
    sortDate === na && sortDate === end
      ? 'both'
      : sortDate === na
        ? 'next_action'
        : 'planned_end';
  return { sortDate, sortSource: source, nextDate: na || null, dueDate: end || null };
}

/** Latest comment with next action date. */
export function getLatestNextActionEntry(comments) {
  let best = null;
  let bestScore = -1;
  let commentIndex = -1;
  (comments || []).forEach((c, i) => {
    const date = String(c.nextActionDate || '').trim();
    if (!date) return;
    const score = parseCommentTs(c);
    if (score >= bestScore) {
      bestScore = score;
      commentIndex = i;
      best = {
        nextAction: String(c.nextAction || '').trim(),
        nextActionDate: date,
        commentSnippet: String(c.text || '').trim(),
        author: c.author || '',
        text: String(c.text || '').trim(),
        ts: c.ts || '',
        flag: !!c.flag,
      };
    }
  });
  return best ? { ...best, commentIndex } : null;
}

/** Comment to edit inline (latest with next action, else latest comment). */
export function getEditableComment(task) {
  const comments = task.comments || [];
  if (!comments.length) return null;
  const withNa = getLatestNextActionEntry(comments);
  if (withNa) return { commentIndex: withNa.commentIndex, comment: comments[withNa.commentIndex] };
  let bestIdx = 0;
  let bestScore = -1;
  comments.forEach((c, i) => {
    const score = parseCommentTs(c);
    if (score >= bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  return { commentIndex: bestIdx, comment: comments[bestIdx] };
}

export function personLeadsDepartment(person, dept) {
  return !!(dept && assigneeMatches(dept.head, person));
}

export function taskInPersonDepartment(ph, person, departments) {
  const dept = getDepartmentForPhase(ph.name, departments);
  return personLeadsDepartment(person, dept);
}

export function hasCommentByPerson(task, person) {
  return (task.comments || []).some((c) => nameMatches(c.author, person));
}

/**
 * @param {object} opts
 * @param {object[]} opts.projects
 * @param {string} opts.person
 * @param {object} opts.departments
 * @param {{ assigned?: boolean, myComments?: boolean, myDepartment?: boolean }} opts.scopes
 * @param {string[]} opts.projectIds — empty = all visible projects
 * @param {string[]} opts.statusFilters — task status codes; empty = all
 */
export function buildMyWorkItems(projects, opts = {}) {
  const person = String(opts.person || '').trim();
  const departments = opts.departments || [];
  const scopes = {
    assigned: opts.scopes?.assigned !== false,
    myComments: !!opts.scopes?.myComments,
    myDepartment: !!opts.scopes?.myDepartment,
  };
  const projectIds = opts.projectIds || [];
  const statusFilters = opts.statusFilters || [];
  const todayStr = todayIso();
  const items = [];
  const idSet = projectIds.length ? new Set(projectIds) : null;

  for (const proj of projects || []) {
    if (idSet && !idSet.has(proj.id)) continue;
    const dm = cDates(proj);
    for (const ph of proj.phases || []) {
      for (const task of ph.tasks || []) {
        const st = taskStatus(task, dm);
        if (!taskMatchesStatusFilters(st, statusFilters)) continue;

        let include = false;
        if (scopes.assigned && assigneeMatches(task.who, person)) include = true;
        if (scopes.myComments && hasCommentByPerson(task, person)) include = true;
        if (scopes.myDepartment && taskInPersonDepartment(ph, person, departments)) include = true;
        if (!include || !person) continue;

        const dept = getDepartmentForPhase(ph.name, departments);
        const chrono = effectiveChronologyDate(task, dm, st);
        const nextEntry = getLatestNextActionEntry(task.comments);
        const sortTs = chrono.sortDate ? new Date(chrono.sortDate).getTime() : 9e15;
        const overdueDays =
          chrono.sortDate && st !== 'completed' && chrono.sortDate < todayStr
            ? dbDays(chrono.sortDate, todayStr)
            : st === 'overdue' && chrono.dueDate
              ? dbDays(chrono.dueDate, todayStr)
              : 0;

        items.push({
          proj,
          ph,
          task,
          st,
          d: dm[task.id] || { s: '', e: '' },
          dept,
          sortDate: chrono.sortDate,
          sortSource: chrono.sortSource,
          nextDate: chrono.nextDate,
          dueDate: chrono.dueDate,
          nextAction: nextEntry,
          editable: getEditableComment(task),
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
    return (a.proj.name || '').localeCompare(b.proj.name || '') || (a.task.name || '').localeCompare(b.task.name || '');
  });

  return { items, todayStr };
}

/** All calendar dates for an item — next action and activity due (planned end). */
export function getItemCalendarDates(item) {
  const dates = [];
  if (item.nextDate) dates.push(String(item.nextDate).trim());
  if (item.dueDate) dates.push(String(item.dueDate).trim());
  if (!dates.length && item.sortDate) dates.push(String(item.sortDate).trim());
  return [...new Set(dates.filter(Boolean))];
}

export function itemMatchesCalendarDay(item, ymd) {
  return getItemCalendarDates(item).includes(ymd);
}

export function calendarDateLabel(item, ymd) {
  const parts = [];
  if (item.nextDate === ymd) parts.push('Next action');
  if (item.dueDate === ymd) parts.push('Due');
  return parts.join(' · ') || 'Scheduled';
}

export function groupMyWorkItems(items, todayStr) {
  const groups = [
    { id: 'overdue', title: 'Overdue', hint: 'Earliest due date in the past', items: [] },
    { id: 'today', title: 'Today', hint: todayStr, items: [] },
    { id: 'week', title: 'Next 7 days', hint: 'Coming up soon', items: [] },
    { id: 'later', title: 'Later', hint: 'Scheduled ahead', items: [] },
    { id: 'nodate', title: 'No date set', hint: 'Set next action or check schedule', items: [] },
    { id: 'done', title: 'Completed', hint: 'Closed tasks', items: [] },
  ];
  const map = Object.fromEntries(groups.map((g) => [g.id, g]));

  for (const it of items) {
    if (it.st === 'completed') {
      map.done.items.push(it);
      continue;
    }
    if (!it.sortDate) {
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
  const overdue = open.filter((i) => getItemCalendarDates(i).some((d) => d < todayStr));
  const dueToday = open.filter((i) => getItemCalendarDates(i).includes(todayStr));
  const dueWeek = open.filter((i) => {
    return getItemCalendarDates(i).some((d) => {
      const diff = dbDays(d, todayStr);
      return diff >= 0 && diff <= 7;
    });
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
