import React from 'react';
import { TaskCommentPanel } from './TaskCommentPanel.jsx';
import { statusLabel, statusBadgeClass } from './preconTaskStatus.js';
import { formatShortDate } from './preconMyWork.js';

/**
 * Side drawer for calendar task detail + comments (My Work & Dashboard Work Calendar).
 */
export function CalendarTaskDrawer({
  item,
  authorName,
  authorEmail,
  departments,
  dispatch,
  toast,
  onClose,
  onOpenProject,
  showAssignee = false,
}) {
  if (!item?.task || !item?.proj || !item?.ph) return null;

  const { proj, ph, task, st, sortDate, nextAction, displayComments } = item;

  return (
    <div className="mw-cal-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="mw-cal-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="mw-cal-drawer-head">
          <div>
            <div className="mw-cal-drawer-kicker">{proj.name} · {ph.name}</div>
            <h3>{task.name}</h3>
          </div>
          <button type="button" className="btg" onClick={onClose}>Close</button>
        </div>
        <span className={`badge ${statusBadgeClass(st)}`}>{statusLabel(st)}</span>
        <p className="mw-sub" style={{ margin: 0, color: '#55504A' }}>
          {showAssignee && task.who ? `Assignee: ${task.who} · ` : ''}
          Next / due: {formatShortDate(sortDate)}
          {nextAction?.nextAction ? ` · ${nextAction.nextAction}` : ''}
        </p>
        <TaskCommentPanel
          proj={proj}
          ph={ph}
          task={task}
          displayComments={displayComments}
          dispatch={dispatch}
          toast={toast}
          authorName={authorName}
          authorEmail={authorEmail}
          departments={departments}
          blankForm
          hideNotifyBanner
          compactForm
        />
        <button type="button" className="btg mw-open-task" onClick={() => onOpenProject?.(proj.id)}>
          Open task in project
        </button>
      </aside>
    </div>
  );
}
