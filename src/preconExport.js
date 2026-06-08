import * as XLSX from 'xlsx';
import { cDates } from './preconDates.js';
import { taskStatus, statusLabel, ensureTaskStatus } from './preconTaskStatus.js';
import { formatRoles } from './preconDepartments.js';
import { formatCommentLine, sortCommentsChronologically } from './preconComments.js';
import { parseAssignees } from './preconAssignees.js';

function commentsText(t) {
  if (!t.comments?.length) return '';
  return sortCommentsChronologically(t.comments).map(({ comment: c }) => formatCommentLine(c)).join(' | ');
}

function flaggedComments(t) {
  return (t.comments || []).filter((c) => c.flag).map((c) => c.text).join(' | ');
}

/** Flatten all tasks across projects. */
export function iterAllTasks(projects, fn) {
  (projects || []).forEach((proj) => {
    (proj.phases || []).forEach((ph) => {
      (ph.tasks || []).forEach((t) => fn({ proj, ph, t }));
    });
  });
}

export function collectAssignees(projects) {
  const set = new Set();
  iterAllTasks(projects, ({ t }) => {
    parseAssignees(t.who).forEach((w) => set.add(w));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

function rowSnapshot({ proj, ph, t }) {
  return {
    Project: proj.name,
    'Project status': proj.status,
    Location: proj.loc,
    Phase: ph.name,
    'Task ID': t.id,
    Task: t.name,
    'Roles (Process)': formatRoles(t),
    Assignee: t.who || '',
    'Stored status': ensureTaskStatus(t),
    Duration_days: t.dur,
    'Manual start': t.ms || '',
    'Actual start': t.as || '',
    'Actual end': t.ae || '',
    Predecessors: (t.pred || []).join('; '),
    Parallel_to: t.par || '',
    Comments_JSON: JSON.stringify(t.comments || []),
    Comment_count: (t.comments || []).length,
  };
}

function rowReport({ proj, ph, t }) {
  const dm = cDates(proj);
  const d = dm[t.id] || { s: '', e: '' };
  const st = taskStatus(t, dm);
  return {
    Project: proj.name,
    Phase: ph.name,
    Task: t.name,
    'Roles (Process)': formatRoles(t),
    Assignee: t.who || '',
    Status: statusLabel(st),
    'Status code': st,
    'Planned start': d.s,
    'Planned end': d.e,
    Duration_days: t.dur,
    'Actual start': t.as || '',
    'Actual end': t.ae || '',
    Kickoff: proj.ko,
    Comments: commentsText(t),
    'Flagged issues': flaggedComments(t),
    'Comment count': (t.comments || []).length,
  };
}

/**
 * @param {object} state — full app state
 * @param {'snapshot'|'report'} mode
 */
export function buildWorkbook(state, mode) {
  const projects = state?.projects || [];
  const rows =
    mode === 'snapshot'
      ? (() => {
          const out = [];
          iterAllTasks(projects, (x) => out.push(rowSnapshot(x)));
          return out;
        })()
      : (() => {
          const out = [];
          iterAllTasks(projects, (x) => out.push(rowReport(x)));
          return out;
        })();

  const meta = [
    { Field: 'Exported at', Value: new Date().toISOString() },
    { Field: 'Mode', Value: mode === 'snapshot' ? 'Current dump (stored fields)' : 'Updated report (computed dates & status)' },
    { Field: 'Projects', Value: projects.length },
    { Field: 'Task rows', Value: rows.length },
    { Field: 'Cloud URL', Value: state?.cloudUrl || '' },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta), 'Info');
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: 'No tasks' }]),
    mode === 'snapshot' ? 'Data dump' : 'Updated report',
  );
  if (mode === 'report') {
    const snap = [];
    iterAllTasks(projects, (x) => snap.push(rowSnapshot(x)));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(snap), 'Raw fields');
  }
  return wb;
}

export function downloadPreconExcel(state, mode) {
  const wb = buildWorkbook(state, mode);
  const suffix = mode === 'snapshot' ? 'dump' : 'report';
  const name = `GA_PreConstruction_${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
  return name;
}
