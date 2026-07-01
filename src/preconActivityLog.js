/** Activity audit log for PreConstruction workspace changes. */

export const ACTIVITY_LOG_MAX = 3000;

const uid = () => `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

let _actor = 'User';

export function setPreconActivityActor(name) {
  _actor = String(name || '').trim() || 'User';
}

export function getPreconActivityActor() {
  return _actor;
}

function ctx(S, action) {
  const proj = (S.projects || []).find((p) => p.id === (action.projId || action.pid));
  const ph = proj?.phases?.find((x) => x.id === action.phId);
  const task = ph?.tasks?.find((x) => x.id === action.tId);
  return {
    projectId: proj?.id || action.projId || action.pid || '',
    projectName: proj?.name || '',
    phaseId: ph?.id || action.phId || '',
    phaseName: ph?.name || '',
    taskId: task?.id || action.tId || '',
    taskName: task?.name || action.taskName || '',
  };
}

function entry(base) {
  return {
    id: uid(),
    at: new Date().toISOString(),
    actor: getPreconActivityActor(),
    ...base,
  };
}

function appendLog(state, logEntry) {
  if (!logEntry) return;
  if (!Array.isArray(state.activityLog)) state.activityLog = [];
  state.activityLog.unshift(logEntry);
  if (state.activityLog.length > ACTIVITY_LOG_MAX) {
    state.activityLog.length = ACTIVITY_LOG_MAX;
  }
}

export function mergeActivityLogs(...sources) {
  const byId = new Map();
  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const row of src) {
      if (row?.id) byId.set(row.id, row);
    }
  }
  return [...byId.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, ACTIVITY_LOG_MAX);
}

const FIELD_LABELS = {
  name: 'name',
  who: 'assignee',
  dur: 'duration',
  status: 'status',
  ms: 'start date',
  roles: 'roles',
};

/** Record one audit row from a reducer action (mutates state.activityLog). */
export function recordActivityFromAction(state, action) {
  if (!state || !action?.type || action.type === 'loadState' || action.type === 'clearFlushFlag' || action.type === 'clearCommentRepairFlag') {
    return;
  }

  const c = ctx(state, action);
  let logEntry = null;

  switch (action.type) {
    case 'addTask':
      logEntry = entry({
        action: 'task.add',
        ...c,
        summary: `Added task "${action.name || 'New Task'}" in ${c.phaseName || 'phase'}`,
        detail: { phaseId: c.phaseId },
      });
      break;
    case 'delTask':
      logEntry = entry({
        action: 'task.delete',
        ...c,
        taskName: action.taskName || c.taskName,
        summary: `Deleted task "${action.taskName || c.taskName || action.tId}"`,
      });
      break;
    case 'updTask': {
      const label = FIELD_LABELS[action.f] || action.f;
      logEntry = entry({
        action: 'task.update',
        ...c,
        summary: `Updated ${label} on "${c.taskName}"`,
        detail: { field: action.f, value: action.f === 'roles' ? action.v : action.v },
      });
      break;
    }
    case 'setMS':
      logEntry = entry({
        action: 'task.date',
        ...c,
        summary: `Set start date on "${c.taskName}" to ${action.v || '—'}`,
        detail: { field: 'ms', value: action.v || null },
      });
      break;
    case 'setTaskStatus':
      logEntry = entry({
        action: 'task.status',
        ...c,
        summary: `Status → ${action.v} on "${c.taskName}"`,
        detail: { field: 'status', value: action.v },
      });
      break;
    case 'markDone':
      logEntry = entry({
        action: 'task.status',
        ...c,
        summary: `Marked complete: "${c.taskName}"`,
        detail: { field: 'status', value: 'completed' },
      });
      break;
    case 'addComment':
      logEntry = entry({
        action: 'comment.add',
        ...c,
        summary: `Comment on "${c.taskName}"`,
        detail: {
          author: action.comment?.author,
          preview: String(action.comment?.text || '').slice(0, 120),
        },
      });
      break;
    case 'updComment':
      logEntry = entry({
        action: 'comment.update',
        ...c,
        summary: `Edited comment on "${c.taskName}"`,
        detail: { commentIndex: action.commentIndex },
      });
      break;
    case 'addTaskAttachments':
      logEntry = entry({
        action: 'attachment.add',
        ...c,
        summary: `Attached ${(action.attachments || []).length} file(s) to "${c.taskName}"`,
        detail: { count: (action.attachments || []).length },
      });
      break;
    case 'reorderTask':
      logEntry = entry({
        action: 'task.reorder',
        ...c,
        summary: `Reordered tasks in ${c.phaseName || 'phase'}`,
      });
      break;
    case 'addPhase':
      logEntry = entry({
        action: 'phase.add',
        projectId: action.projId,
        projectName: (state.projects || []).find((p) => p.id === action.projId)?.name || '',
        summary: `Added phase "${action.name || 'New Phase'}"`,
        detail: { name: action.name },
      });
      break;
    case 'delPhase':
      logEntry = entry({
        action: 'phase.delete',
        projectId: action.projId,
        summary: `Deleted phase ${action.phId}`,
      });
      break;
    case 'reorderPhase':
      logEntry = entry({
        action: 'phase.reorder',
        projectId: action.projId,
        summary: 'Reordered project phases',
      });
      break;
    case 'addProject':
      logEntry = entry({
        action: 'project.add',
        projectId: action.proj?.id,
        projectName: action.proj?.name,
        summary: `Created project "${action.proj?.name || action.proj?.id}"`,
      });
      break;
    case 'delProject':
      logEntry = entry({
        action: 'project.delete',
        projectId: action.pid,
        summary: `Deleted project ${action.pid}`,
      });
      break;
    case 'updProject':
      logEntry = entry({
        action: 'project.update',
        projectId: action.pid,
        projectName: (state.projects || []).find((p) => p.id === action.pid)?.name || '',
        summary: `Updated project settings`,
        detail: { fields: action.fields },
      });
      break;
    case 'setKO': {
      const p = (state.projects || []).find((x) => x.id === action.pid);
      logEntry = entry({
        action: 'project.kickoff',
        projectId: action.pid,
        projectName: p?.name || '',
        summary: `Kickoff date → ${action.v}`,
        detail: { kickoff: action.v },
      });
      break;
    }
    case 'setDepartmentHead': {
      const d = (state.departments || []).find((x) => x.id === action.deptId);
      logEntry = entry({
        action: 'department.head',
        summary: `Department head: ${d?.name || action.deptId} → ${action.head || '—'}`,
        detail: { deptId: action.deptId, head: action.head },
      });
      break;
    }
    default:
      break;
  }

  appendLog(state, logEntry);
}

export const ACTIVITY_ACTION_LABELS = {
  'task.add': 'Task added',
  'task.delete': 'Task deleted',
  'task.update': 'Task updated',
  'task.date': 'Start date changed',
  'task.status': 'Status changed',
  'task.reorder': 'Tasks reordered',
  'comment.add': 'Comment posted',
  'comment.update': 'Comment edited',
  'attachment.add': 'File attached',
  'phase.add': 'Phase added',
  'phase.delete': 'Phase deleted',
  'phase.reorder': 'Phases reordered',
  'project.add': 'Project created',
  'project.delete': 'Project deleted',
  'project.update': 'Project updated',
  'project.kickoff': 'Kickoff changed',
  'department.head': 'Dept head updated',
};

export function formatActivityAction(action) {
  return ACTIVITY_ACTION_LABELS[action] || action || 'Activity';
}

export function filterActivityLog(logs, { query = '', projectId = '', action = '', from = '', to = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (logs || []).filter((row) => {
    if (projectId && row.projectId !== projectId) return false;
    if (action && row.action !== action) return false;
    if (from && String(row.at).slice(0, 10) < from) return false;
    if (to && String(row.at).slice(0, 10) > to) return false;
    if (!q) return true;
    const hay = [
      row.summary,
      row.actor,
      row.projectName,
      row.phaseName,
      row.taskName,
      row.action,
      JSON.stringify(row.detail || ''),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

export function activityLogToCsv(rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'Timestamp,Actor,Action,Project,Phase,Task,Summary,Detail';
  const lines = (rows || []).map((r) =>
    [
      r.at,
      r.actor,
      formatActivityAction(r.action),
      r.projectName || r.projectId,
      r.phaseName,
      r.taskName || r.taskId,
      r.summary,
      r.detail ? JSON.stringify(r.detail) : '',
    ]
      .map(esc)
      .join(','),
  );
  return [header, ...lines].join('\n');
}
