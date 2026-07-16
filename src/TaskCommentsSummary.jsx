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
export function TaskCommentsSummary({
  comments,
  compact = false,
  emptyLabel = 'No comments yet',
  hideNotifyMeta = true,
  title = 'Previous comments',
}) {
  const sorted = sortCommentsNewestFirst(comments);

  if (!sorted.length) {
    return (
      <div className="tcc-history">
        {title ? <h4 className="tcc-history-title">{title}</h4> : null}
        <p className="tcc-empty">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="tcc-history">
      {title ? (
        <h4 className="tcc-history-title">
          {title}
          <span className="tcc-history-count">{sorted.length}</span>
        </h4>
      ) : null}
      <ol className={`tcc-timeline tcc-timeline-v2${compact ? ' tcc-timeline-compact' : ''}`}>
        {sorted.map(({ comment: cm, index: origIndex }, displayIndex) => (
          <li
            key={commentKey(cm, origIndex)}
            className={`tcc-entry${cm.flag ? ' tcc-entry-flag' : ''}${displayIndex === 0 ? ' tcc-entry-latest' : ''}`}
          >
            <div className="tcc-entry-head">
              <span className="tcc-entry-seq">{displayIndex === 0 ? 'Latest' : `#${sorted.length - displayIndex}`}</span>
              <span className="tcc-entry-author">{cm.author || 'Anon'}</span>
              <time className="tcc-entry-time">{cm.ts || (cm.createdAt ? formatShortDate(cm.createdAt) : '—')}</time>
              {cm.flag ? <span className="tcc-entry-badge">Issue</span> : null}
            </div>
            <p className="tcc-entry-text">{cm.text}</p>
            {cm.nextAction || cm.nextActionDate ? (
              <div className="tcc-entry-next">
                <span className="tcc-entry-next-lbl">Next</span>
                <span className="tcc-entry-next-text">{cm.nextAction || '—'}</span>
                {cm.nextActionDate ? (
                  <span className="tcc-entry-next-due">· Due {formatShortDate(cm.nextActionDate)}</span>
                ) : null}
              </div>
            ) : null}
            <AttachmentLinks attachments={cm.attachments} />
            {cm.attachmentsPending ? (
              <div className="tcc-entry-meta">Uploading attachments…</div>
            ) : null}
            {cm.attachmentError ? (
              <div className="tcc-entry-meta tcc-entry-meta-err">Attachment failed: {cm.attachmentError}</div>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
