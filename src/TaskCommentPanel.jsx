import React from 'react';
import { CommentForm } from './CommentForm.jsx';
import { getEditableComment } from './preconMyWork.js';
import { TaskCommentsSummary } from './TaskCommentsSummary.jsx';

/**
 * Shared comment history + post/edit form (project tasks and My Work).
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
  historyTitle = 'Previous comments',
}) {
  const editable = !blankForm && allowEditLatest ? getEditableComment(task) : null;
  const initial = blankForm || !editable?.comment
    ? {}
    : {
        text: editable.comment.text || '',
        nextAction: editable.comment.nextAction || '',
        nextActionDate: editable.comment.nextActionDate || '',
      };

  return (
    <>
      {!hideHistory ? (
        <TaskCommentsSummary comments={task.comments} title={historyTitle} hideNotifyMeta />
      ) : null}
      <div className="cform-section">
        <h4 className="cform-section-title">New comment &amp; next action</h4>
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
          submitLabel={editable && !blankForm ? 'Save changes' : 'Post comment'}
          hideNotifyBanner={hideNotifyBanner}
          compact={compactForm}
          toast={toast}
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
