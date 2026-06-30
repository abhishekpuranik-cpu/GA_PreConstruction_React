import React from 'react';
import { AttachmentLinks } from './AttachmentPicker.jsx';
import { sortCommentsNewestFirst } from './preconComments.js';
import { formatShortDate } from './preconMyWork.js';

function commentKey(cm, index) {
  return `${cm.createdAt || ''}-${cm.ts || ''}-${cm.author || 'anon'}-${index}`;
}

/**
 * Read-only consolidated comment timeline for a task.
 */
export function TaskCommentsSummary({ comments, compact = false, emptyLabel = 'No comments yet' }) {
  const sorted = sortCommentsNewestFirst(comments);

  if (!sorted.length) {
    return <p className="tcc-empty">{emptyLabel}</p>;
  }

  return (
    <ol className={`tcc-timeline${compact ? ' tcc-timeline-compact' : ''}`}>
      {sorted.map(({ comment: cm }, index) => (
        <li
          key={commentKey(cm, index)}
          className={`tcc-entry${cm.flag ? ' tcc-entry-flag' : ''}`}
        >
          <div className="tcc-entry-head">
            <span className="tcc-entry-author">{cm.author || 'Anon'}</span>
            <time className="tcc-entry-time">{cm.ts || '—'}</time>
            {cm.flag ? <span className="tcc-entry-badge">Issue</span> : null}
          </div>
          <p className="tcc-entry-text">{cm.text}</p>
          {cm.nextAction || cm.nextActionDate ? (
            <div className="tcc-entry-next">
              <span className="tcc-entry-next-lbl">Next action</span>
              <span>{cm.nextAction || '—'}</span>
              {cm.nextActionDate ? (
                <span className="tcc-entry-next-due">Due {formatShortDate(cm.nextActionDate)}</span>
              ) : null}
            </div>
          ) : null}
          <AttachmentLinks attachments={cm.attachments} />
          {cm.attachmentsPending ? (
            <div className="tcc-entry-meta">Uploading attachments…</div>
          ) : cm.attachmentError ? (
            <div className="tcc-entry-meta tcc-entry-meta-err">Attachment failed: {cm.attachmentError}</div>
          ) : null}
          {cm.notifyRecipients?.length ? (
            <div className="tcc-entry-meta">
              {cm.emailSent
                ? `Email sent to ${cm.notifyRecipients.map((r) => r.name || r.email).join(', ')}`
                : cm.emailQueued
                  ? `Email queued for ${cm.notifyRecipients.map((r) => r.name || r.email).join(', ')}`
                  : cm.emailError
                    ? `Email failed: ${cm.emailError}`
                    : cm.notifyPending !== false
                      ? 'Sending notifications…'
                      : 'Notify pending'}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
