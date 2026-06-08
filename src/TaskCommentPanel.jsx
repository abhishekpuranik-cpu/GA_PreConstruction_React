import React from 'react';
import { AttachmentLinks } from './AttachmentPicker.jsx';
import { CommentForm } from './CommentForm.jsx';
import { sortCommentsChronologically } from './preconComments.js';
import { formatShortDate, getEditableComment } from './preconMyWork.js';

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
}) {
  const editable = allowEditLatest ? getEditableComment(task) : null;
  const initial = editable?.comment
    ? {
        text: editable.comment.text || '',
        nextAction: editable.comment.nextAction || '',
        nextActionDate: editable.comment.nextActionDate || '',
      }
    : {};

  return (
    <>
      {(task.comments || []).length > 0 ? (
        <div className="mw-comment-history">
          <div className="mw-comment-history-title">Comment history (oldest first)</div>
          {sortCommentsChronologically(task.comments).map(({ comment: cm }) => (
            <div key={`${cm.createdAt || ''}-${cm.ts || ''}-${cm.author}`} className="citem mw-ch-item">
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  gap: 4,
                  marginBottom: 3,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: '#1A304A' }}>{cm.author || 'Anon'}</span>
                <span style={{ fontSize: 10, color: '#96918A' }}>{cm.ts || '—'}</span>
              </div>
              <div style={{ fontSize: 12, color: '#1A1815', lineHeight: 1.5 }}>{cm.text}</div>
              {cm.nextAction || cm.nextActionDate ? (
                <div style={{ fontSize: 11, color: '#1A304A', marginTop: 6, lineHeight: 1.45 }}>
                  <span style={{ fontWeight: 600 }}>Next action:</span> {cm.nextAction || '—'}
                  {cm.nextActionDate ? (
                    <span style={{ color: '#55504A' }}> · Due {formatShortDate(cm.nextActionDate)}</span>
                  ) : null}
                </div>
              ) : null}
              <AttachmentLinks attachments={cm.attachments} />
              {cm.attachmentsPending ? (
                <div className="c-email-meta">📎 Uploading attachments…</div>
              ) : cm.attachmentError ? (
                <div className="c-email-meta">📎 Attachment failed: {cm.attachmentError}</div>
              ) : null}
              {cm.notifyRecipients?.length ? (
                <div className="c-email-meta">
                  {cm.emailSent
                    ? `✉ Sent to ${cm.notifyRecipients.map((r) => r.name || r.email).join(', ')}`
                    : cm.emailQueued
                      ? `✉ Email queued for ${cm.notifyRecipients.map((r) => r.name || r.email).join(', ')}`
                      : cm.emailError
                        ? `✉ Email failed: ${cm.emailError}`
                        : cm.notifyPending !== false
                          ? '✉ Sending notifications…'
                          : '✉ Notify pending'}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#96918A', fontStyle: 'italic', marginBottom: 10 }}>No comments yet</div>
      )}
      <CommentForm
        key={`${task.id}-${editable?.commentIndex ?? 'new'}`}
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
        submitLabel={editable ? 'Save changes' : 'Post comment'}
        toast={toast}
        onSaved={(comment) => {
          if (editable) {
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
    </>
  );
}
