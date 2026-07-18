import { cDates, dbDays } from './preconDates.js';
import { taskMatchesStatusFilters, taskStatus, todayIso } from './preconTaskStatus.js';
import { getDepartmentForPhase, taskMatchesRoleFilter } from './preconDepartments.js';
import { assigneeMatches, nameMatches, taskMatchesAssigneeFilter } from './preconAssignees.js';
import { commentSortKey, collectTaskComments, normalizeTaskComments, normTaskKey } from './preconComments.js';

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

/**
 * Current work date for calendars / overdue lists.
 * When a next-action date is set, it supersedes the planned end so moved work
 * no longer appears on the old (past) schedule day.
 */
export function effectiveChronologyDate(task, dm, st) {
  const next = getLatestNextActionEntry(task.comments);
  const na = next?.nextActionDate ? String(next.nextActionDate).trim() : null;
  const end = st !== 'completed' && dm[task.id]?.e ? String(dm[task.id].e).trim() : null;
  const naOk = na && !Number.isNaN(new Date(na).getTime()) ? na : null;
  const endOk = end && !Number.isNaN(new Date(end).getTime()) ? end : null;
  if (naOk) {
    return { sortDate: naOk, sortSource: 'next_action', nextDate: naOk, dueDate: endOk };
  }
  if (endOk) {
    return { sortDate: endOk, sortSource: 'planned_end', nextDate: null, dueDate: endOk };
  }
  return { sortDate: null, sortSource: null, nextDate: null, dueDate: endOk };
}

/** Latest comment with next action date. */
export function getLatestNextActionEntry(comments) {
  const list = normalizeTaskComments(comments);
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
export function getEditableComment(task, ctx = null) {
  const comments = ctx?.displayComments
    ?? (ctx?.proj ? collectTaskComments(ctx.proj, ctx.ph, task) : normalizeTaskComments(task?.comments));
  if (!comments.length) return null;
  const withNa = getLatestNextActionEntry(comments);
  if (withNa) {
    const raw = task.comments || [];
    const rawIndex = raw.findIndex((c) => {
      const text = String(c?.text ?? c?.comment ?? '').trim();
      return text && text === withNa.text && String(c?.author || '').trim() === String(withNa.author || '').trim();
    });
    if (rawIndex >= 0) return { commentIndex: rawIndex, comment: raw[rawIndex] };
    return { commentIndex: comments.length - 1, comment: withNa };
  }
  let bestIdx = 0;
  let bestScore = -1;
  comments.forEach((c, i) => {
    const score = parseCommentTs(c);
    if (score >= bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  });
  const latest = comments[bestIdx];
  const raw = task.comments || [];
  const rawIndex = raw.findIndex((c) => {
    const text = String(c?.text ?? c?.comment ?? '').trim();
    return text && text === String(latest?.text || '').trim();
  });
  return {
    commentIndex: rawIndex >= 0 ? rawIndex : bestIdx,
    comment: rawIndex >= 0 ? raw[rawIndex] : latest,
  };
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

function pushWorkItem(items, { proj, ph, task, st, dm, departments, todayStr }) {
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

function sortWorkItems(items) {
  items.sort((a, b) => {
    const aDone = a.st === 'completed' ? 1 : 0;
    const bDone = b.st === 'completed' ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    if (a.sortTs !== b.sortTs) return a.sortTs - b.sortTs;
    return (a.proj.name || '').localeCompare(b.proj.name || '') || (a.task.name || '').localeCompare(b.task.name || '');
  });
  return items;
}

/**
 * All tasks across projects for portfolio / department calendar (any assignee).
 */
export function buildPortfolioWorkItems(projects, opts = {}) {
  const departments = opts.departments || [];
  const statusFilters = opts.statusFilters || [];
  const assigneeFilter = String(opts.assigneeFilter || '').trim();
  const roleFilter = opts.roleFilter || '';
  const projectIds = Object.prototype.hasOwnProperty.call(opts, 'projectIds')
    ? opts.projectIds
    : null;
  const todayStr = todayIso();
  const items = [];
  // null/undefined = all projects; [] = none; [ids] = subset
  const idSet = projectIds == null ? null : new Set(projectIds);

  for (const proj of projects || []) {
    if (idSet && !idSet.has(proj.id)) continue;
    const dm = cDates(proj);
    for (const ph of proj.phases || []) {
      for (const task of ph.tasks || []) {
        const st = taskStatus(task, dm);
        if (!taskMatchesStatusFilters(st, statusFilters)) continue;
        if (!taskMatchesAssigneeFilter(task.who, assigneeFilter)) continue;
        if (!taskMatchesRoleFilter(task, roleFilter)) continue;
        pushWorkItem(items, { proj, ph, task, st, dm, departments, todayStr });
      }
    }
  }

  return { items: sortWorkItems(items), todayStr };
}

/** Resolve live project / phase / task from workspace (drawer must not use stale snapshots). */
export function resolveWorkItemFromProjects(projects, item) {
  if (!item?.proj?.id || !item?.task) return item;
  const taskId = item.task.id;
  const taskNameKey = normTaskKey(item.task.name);

  for (const proj of projects || []) {
    if (proj.id !== item.proj.id) continue;

    let ph = null;
    let task = null;

    for (const phase of proj.phases || []) {
      const hit = (phase.tasks || []).find((t) => t.id === taskId);
      if (hit) {
        ph = phase;
        task = hit;
        break;
      }
    }

    if (!task && taskNameKey) {
      const preferred = (proj.phases || []).find((p) => p.id === item.ph?.id);
      const searchOrder = preferred
        ? [preferred, ...(proj.phases || []).filter((p) => p.id !== preferred.id)]
        : (proj.phases || []);
      for (const phase of searchOrder) {
        const hit = (phase.tasks || []).find((t) => normTaskKey(t.name) === taskNameKey);
        if (hit) {
          ph = phase;
          task = hit;
          break;
        }
      }
    }

    if (!task) return item;

    return { ...item, proj, ph, task };
  }

  return item;
}

/**
 * @param {object} opts
 * @param {object[]} opts.projects
 * @param {string} opts.person
 * @param {object} opts.departments
 * @param {{ assigned?: boolean, myComments?: boolean, myDepartment?: boolean }} opts.scopes
 * @param {string[]|null|undefined} opts.projectIds — null/undefined = all; [] = none; otherwise subset
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
  const projectIds = Object.prototype.hasOwnProperty.call(opts, 'projectIds')
    ? opts.projectIds
    : null;
  const statusFilters = opts.statusFilters || [];
  const todayStr = todayIso();
  const items = [];
  const idSet = projectIds == null ? null : new Set(projectIds);

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

        pushWorkItem(items, { proj, ph, task, st, dm, departments, todayStr });
      }
    }
  }

  return { items: sortWorkItems(items), todayStr };
}

/**
 * Single current calendar date — next action when set, else planned end.
 * Avoids leaving the same task on past schedule days after next-action moves forward.
 */
export function getItemCalendarDates(item) {
  const next = String(item.nextDate || '').trim();
  if (next) return [next];
  const due = String(item.dueDate || item.sortDate || '').trim();
  return due ? [due] : [];
}

export function itemMatchesCalendarDay(item, ymd) {
  return getItemCalendarDates(item).includes(ymd);
}

export function calendarDateLabel(item, ymd) {
  if (item.nextDate && item.nextDate === ymd) return 'Next action';
  if (item.dueDate === ymd) return 'Due';
  if (item.sortDate === ymd) return 'Scheduled';
  return 'Scheduled';
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

export function summarizeDepartments(items, todayStr) {
  const byId = new Map();
  for (const it of items || []) {
    const id = it.dept?.id || '_other';
    const name = it.dept?.name || 'Unmapped';
    if (!byId.has(id)) {
      byId.set(id, { id, name, open: 0, overdue: 0, today: 0, total: 0 });
    }
    const g = byId.get(id);
    g.total += 1;
    if (it.st === 'completed') continue;
    g.open += 1;
    const dates = getItemCalendarDates(it);
    if (dates.some((d) => d < todayStr)) g.overdue += 1;
    if (dates.includes(todayStr)) g.today += 1;
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterItemsByDepartment(items, departmentId) {
  if (!departmentId) return items || [];
  return (items || []).filter((it) => (it.dept?.id || '_other') === departmentId);
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
