import React, { useEffect, useMemo, useState } from 'react';
import { TaskCommentPanel } from './TaskCommentPanel.jsx';
import { TaskCommentsSummary } from './TaskCommentsSummary.jsx';
import { collectTaskComments } from './preconComments.js';
import { getEditableComment } from './preconMyWork.js';
import { cDates } from './preconDates.js';
import { statusBadgeClass, statusLabel, taskStatus } from './preconTaskStatus.js';
import { formatShortDate } from './preconMyWork.js';
import { AssigneeMultiSelect } from './AssigneeMultiSelect.jsx';

/**
 * Full comment workspace modal — timeline + compose (project Tasks tab).
 * Assignee picker matches the project Tasks page and saves immediately.
 */
export function TaskCommentModal({
  open,
  onClose,
  proj,
  ph,
  task,
  dispatch,
  toast,
  authorName,
  authorEmail,
  departments,
  assigneeOptions = [],
  onOpenProject,
}) {
  const [composeMode, setComposeMode] = useState('new');

  const liveTask = useMemo(() => {
    if (!open || !task?.id || !ph?.id || !proj?.id) return null;
    const p = (proj.phases || []).find((x) => x.id === ph.id);
    const t = p?.tasks?.find((x) => x.id === task.id);
    return t || task;
  }, [open, proj, ph, task]);

  const displayComments = useMemo(
    () => (liveTask && ph ? collectTaskComments(proj, ph, liveTask) : []),
    [proj, ph, liveTask],
  );

  const editable = useMemo(
    () => (liveTask ? getEditableComment(liveTask, { proj, ph, displayComments }) : null),
    [liveTask, proj, ph, displayComments],
  );

  useEffect(() => {
    if (!open) return undefined;
    setComposeMode('new');
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, task?.id, onClose]);

  if (!open || !liveTask || !ph || !proj) return null;

  const dm = cDates(proj);
  const d = dm[liveTask.id] || { s: '', e: '' };
  const st = taskStatus(liveTask, dm);
  const commentCount = displayComments.length;

  const saveAssignee = (who) => {
    const next = who == null ? '' : String(who);
    if (next === String(liveTask.who || '')) return;
    dispatch({
      type: 'updTask',
      projId: proj.id,
      phId: ph.id,
      tId: liveTask.id,
      f: 'who',
      v: next,
    });
  };

  return (
    <div className="tcm-backdrop" onClick={onClose} role="presentation">
      <div
        className="tcm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tcm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tcm-hero">
          <div className="tcm-hero-bg" aria-hidden />
          <div className="tcm-hero-inner">
            <div className="tcm-hero-top">
              <div className="tcm-kicker">
                <span className="tcm-kicker-proj">{proj.name}</span>
                <span className="tcm-kicker-dot">·</span>
                <span className="tcm-kicker-phase">{ph.name}</span>
              </div>
              <button type="button" className="tcm-close" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
            <h2 id="tcm-title" className="tcm-title disp">
              {liveTask.name}
            </h2>
            <div className="tcm-chips">
              <span className={`badge ${statusBadgeClass(st)}`}>{statusLabel(st)}</span>
              <div className="tcm-assignee" title="Same assignee picker as the project Tasks page">
                <span className="tcm-assignee-lbl">Assignee</span>
                <AssigneeMultiSelect
                  value={liveTask.who || ''}
                  options={assigneeOptions}
                  onChange={saveAssignee}
                />
              </div>
              {d.e ? <span className="tcm-chip">Due {formatShortDate(d.e)}</span> : null}
              <span className="tcm-chip tcm-chip-gold">
                {commentCount} comment{commentCount !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </header>

        <div className="tcm-body">
          <section className="tcm-pane tcm-pane-history">
            <div className="tcm-pane-head">
              <h3 className="tcm-pane-title">Comment history</h3>
              <span className="tcm-pane-hint">Newest first</span>
            </div>
            <div className="tcm-pane-scroll">
              <TaskCommentsSummary
                comments={displayComments}
                title=""
                emptyLabel="No comments yet — add your first update on the right."
              />
            </div>
          </section>

          <section className="tcm-pane tcm-pane-compose">
            <div className="tcm-pane-head">
              <h3 className="tcm-pane-title">Your update</h3>
              {editable ? (
                <div className="tcm-mode" role="tablist" aria-label="Comment mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={composeMode === 'edit'}
                    className={`tcm-mode-btn${composeMode === 'edit' ? ' act' : ''}`}
                    onClick={() => setComposeMode('edit')}
                  >
                    Edit latest
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={composeMode === 'new'}
                    className={`tcm-mode-btn${composeMode === 'new' ? ' act' : ''}`}
                    onClick={() => setComposeMode('new')}
                  >
                    New comment
                  </button>
                </div>
              ) : (
                <span className="tcm-pane-hint">Post a new update</span>
              )}
            </div>
            <div className="tcm-pane-scroll tcm-pane-scroll-compose">
              <TaskCommentPanel
                key={`${liveTask.id}-${composeMode}`}
                proj={proj}
                ph={ph}
                task={liveTask}
                displayComments={displayComments}
                dispatch={dispatch}
                toast={toast}
                authorName={authorName}
                authorEmail={authorEmail}
                departments={departments}
                assigneeOptions={assigneeOptions}
                allowEditLatest={composeMode === 'edit'}
                blankForm={composeMode === 'new'}
                hideHistory
                hideNotifyBanner={composeMode === 'edit'}
                compactForm={false}
                historyTitle=""
              />
            </div>
          </section>
        </div>

        <footer className="tcm-foot">
          <p className="tcm-foot-note">
            Click <strong>Save</strong> in the top bar after your update so the team sees it on Reload · Email &amp; WhatsApp notify dept heads and assignees when configured
          </p>
          <div className="tcm-foot-actions">
            {onOpenProject ? (
              <button type="button" className="btg" onClick={() => onOpenProject(proj.id)}>
                Open task in project
              </button>
            ) : null}
            <button type="button" className="btp" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
