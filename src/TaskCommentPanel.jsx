import React, { useMemo } from 'react';
import { CommentForm } from './CommentForm.jsx';
import { collectTaskComments } from './preconComments.js';
import { getEditableComment } from './preconMyWork.js';
import { TaskCommentsSummary } from './TaskCommentsSummary.jsx';
import { taskStatusSelectValue, statusLabel } from './preconTaskStatus.js';
import { notifyTaskStatusChange } from './preconNotify.js';

function composeModeLabel(editable, blankForm) {
  if (editable && !blankForm) return 'Edit latest update';
  return 'New comment & next action';
}

/**
 * Shared comment history + post/edit form (project tasks and My Work).
 * Task assignee is edited via the project Tasks picker / comment modal header.
 */
export function TaskCommentPanel({
  proj,
  ph,
  task,
  dispatch,
  toast,
  authorName,
  authorEmail,
  departments,
  allowEditLatest = true,
  hideHistory = false,
  blankForm = false,
  hideNotifyBanner = false,
  compactForm = false,
  displayComments: displayCommentsProp,
  historyTitle = 'Previous comments',
}) {
  const displayComments = useMemo(
    () => displayCommentsProp ?? collectTaskComments(proj, ph, task),
    [displayCommentsProp, proj, ph, task],
  );
  const editable = !blankForm && allowEditLatest ? getEditableComment(task, { proj, ph }) : null;
  const initial = blankForm || !editable?.comment
    ? {}
    : {
        text: editable.comment.text || '',
        nextAction: editable.comment.nextAction || '',
        nextActionDate: editable.comment.nextActionDate || '',
      };
  const storedStatus = taskStatusSelectValue(task);
  const alreadyComplete = storedStatus === 'completed';

  return (
    <>
      {!hideHistory ? (
        <TaskCommentsSummary comments={displayComments} title={historyTitle} hideNotifyMeta />
      ) : null}
      <div className="cform-section">
        <h4 className="cform-section-title">{composeModeLabel(editable, blankForm)}</h4>
        {alreadyComplete ? (
          <p className="cform-complete-done">This activity is already marked complete.</p>
        ) : null}
        <CommentForm
          key={blankForm ? `${task.id}-new` : `${task.id}-${editable?.commentIndex ?? 'new'}`}
          projectId={proj.id}
          taskId={task.id}
          taskWho={task.who || ''}
          departments={departments}
          authorName={authorName}
          authorEmail={authorEmail}
          projectName={proj.name}
          phaseName={ph.name}
          taskName={task.name}
          taskAttachmentIds={(task.attachments || []).map((a) => a.id).filter(Boolean)}
          initial={initial}
          submitLabel="Save"
          hideNotifyBanner={hideNotifyBanner}
          compact={compactForm}
          toast={toast}
          allowMarkComplete={!alreadyComplete}
          onMarkComplete={() => {
            const prev = taskStatusSelectValue(task);
            if (prev === 'completed') return;
            dispatch({ type: 'markDone', projId: proj.id, phId: ph.id, tId: task.id });
            if (authorName) {
              void notifyTaskStatusChange({
                projectId: proj.id,
                taskId: task.id,
                projectName: proj.name,
                phaseName: ph.name,
                taskWho: task.who,
                taskName: task.name,
                author: authorName,
                oldLabel: statusLabel(prev) || prev,
                newLabel: 'Completed',
              }, toast);
            }
          }}
          onSaved={(comment) => {
            if (editable && !blankForm) {
              dispatch({
                type: 'updComment',
                projId: proj.id,
                phId: ph.id,
                tId: task.id,
                commentIndex: editable.commentIndex,
                patch: {
                  text: comment.text,
                  nextAction: comment.nextAction,
                  nextActionDate: comment.nextActionDate,
                  flag: comment.flag,
                  markedComplete: !!comment.markedComplete,
                  attachments: [...(editable.comment?.attachments || []), ...(comment.attachments || [])],
                  notifyRecipients: comment.notifyRecipients,
                  notifyPending: comment.notifyPending,
                  emailSent: comment.emailSent,
                  emailError: comment.emailError,
                },
              });
              return editable.commentIndex;
            }
            const idx = (task.comments || []).length;
            dispatch({
              type: 'addComment',
              projId: proj.id,
              phId: ph.id,
              tId: task.id,
              comment,
            });
            return idx;
          }}
          onNotifyComplete={(patch, commentIndex) => {
            dispatch({
              type: 'updComment',
              projId: proj.id,
              phId: ph.id,
              tId: task.id,
              commentIndex,
              patch,
            });
          }}
        />
      </div>
    </>
  );
}
