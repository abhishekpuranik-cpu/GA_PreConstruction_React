import { cDates, dbDays } from './preconDates.js';
import { ensureTaskStatus, taskStatus, todayIso } from './preconTaskStatus.js';
import { getLatestNextActionEntry } from './preconMyWork.js';

/**
 * Process compliance: open tasks must be completed on or before schedule end
 * and latest next-action date, OR those dates must be extended to today/future.
 *
 * Extension = latest comment nextActionDate >= today, OR planned end >= today.
 */
export function assessTaskCompliance(task, dm, todayStr = todayIso()) {
  const stored = ensureTaskStatus(task);
  if (stored === 'completed' || task.ae) return null;
  if (stored === 'paused') return null;

  const plannedEnd = dm?.[task.id]?.e ? String(dm[task.id].e).trim() : null;
  const plannedStart = dm?.[task.id]?.s ? String(dm[task.id].s).trim() : null;
  const next = getLatestNextActionEntry(task.comments || []);
  const nextDate = next?.nextActionDate ? String(next.nextActionDate).trim() : null;

  if (nextDate && nextDate >= todayStr) return null;
  if (plannedEnd && plannedEnd >= todayStr && (!nextDate || nextDate >= todayStr)) return null;

  const breaches = [];

  if (nextDate && nextDate < todayStr) {
    breaches.push({
      kind: 'next_action',
      label: 'Next action not extended',
      date: nextDate,
      daysOverdue: dbDays(nextDate, todayStr),
      detail: next?.nextAction || '',
      author: next?.author || '',
    });
  }

  if (plannedEnd && plannedEnd < todayStr) {
    breaches.push({
      kind: 'schedule',
      label: 'Schedule due overdue',
      date: plannedEnd,
      daysOverdue: dbDays(plannedEnd, todayStr),
      detail: '',
      author: '',
    });
  }

  if (!breaches.length) {
    if (taskStatus(task, dm) === 'overdue' && plannedEnd) {
      breaches.push({
        kind: 'schedule',
        label: 'Schedule due overdue',
        date: plannedEnd,
        daysOverdue: dbDays(plannedEnd, todayStr),
        detail: '',
        author: '',
      });
    } else {
      return null;
    }
  }

  breaches.sort((a, b) => b.daysOverdue - a.daysOverdue);
  const primary = breaches[0];

  return {
    breaches,
    primaryKind: primary.kind,
    breachDate: primary.date,
    daysOverdue: primary.daysOverdue,
    plannedEnd,
    plannedStart,
    nextActionDate: nextDate,
    nextAction: next?.nextAction || '',
    nextActionAuthor: next?.author || '',
    status: taskStatus(task, dm),
  };
}

export function buildComplianceItems(projects, todayStr = todayIso()) {
  const items = [];
  for (const proj of projects || []) {
    const dm = cDates(proj);
    for (const ph of proj.phases || []) {
      for (const task of ph.tasks || []) {
        const assessment = assessTaskCompliance(task, dm, todayStr);
        if (!assessment) continue;
        items.push({ proj, ph, task, ...assessment });
      }
    }
  }
  items.sort((a, b) => {
    if (b.daysOverdue !== a.daysOverdue) return b.daysOverdue - a.daysOverdue;
    return (a.proj?.name || '').localeCompare(b.proj?.name || '') || (a.task?.name || '').localeCompare(b.task?.name || '');
  });
  return items;
}

export function filterComplianceItems(items, { projectId = '', query = '', kind = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (items || []).filter((row) => {
    if (projectId && row.proj?.id !== projectId) return false;
    if (kind && !row.breaches?.some((b) => b.kind === kind)) return false;
    if (!q) return true;
    const hay = [
      row.proj?.name,
      row.ph?.name,
      row.task?.name,
      row.task?.who,
      row.nextAction,
      row.breaches?.map((b) => b.label).join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function complianceToCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header =
    'Project,Phase,Task,Assignee,Status,Breach type,Days overdue,Breach date,Planned end,Next action date,Next action,Comment author';
  const lines = (rows || []).map((r) => {
    const kinds = (r.breaches || []).map((b) => b.label).join('; ');
    return [
      r.proj?.name,
      r.ph?.name,
      r.task?.name,
      r.task?.who,
      r.status,
      kinds,
      r.daysOverdue,
      r.breachDate,
      r.plannedEnd,
      r.nextActionDate,
      r.nextAction,
      r.nextActionAuthor,
    ]
      .map(esc)
      .join(',');
  });
  return [header, ...lines].join('\n');
}

export const COMPLIANCE_KIND_LABELS = {
  schedule: 'Schedule due',
  next_action: 'Next action',
};
