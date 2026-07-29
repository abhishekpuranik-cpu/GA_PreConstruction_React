import React, { useState } from 'react';
import { decideDrawing } from './preconDrawings.js';
import './drawingApprovalPanel.css';

const DECISIONS = [
  { id: 'approve', label: 'Approve', className: 'dap-approve' },
  { id: 'changes', label: 'Send back with changes', className: 'dap-changes' },
  { id: 'reject', label: 'Reject', className: 'dap-reject' },
];

export function DrawingApprovalPanel({
  task,
  proj,
  ph,
  dispatch,
  toast,
  onPersist,
  onOpenProject,
}) {
  const review = task?.drawingReview;
  const [decision, setDecision] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!review?.drawingId) return null;

  const submit = async () => {
    if (!decision) return;
    if ((decision === 'changes' || decision === 'reject') && !note.trim()) {
      toast?.('Add review comments before sending back or rejecting', 'err');
      return;
    }
    setBusy(true);
    try {
      const result = await decideDrawing(review.drawingId, decision, note.trim());
      dispatch({
        type: 'drawingReviewDecision',
        projId: proj.id,
        phId: ph.id,
        tId: task.id,
        decision,
        status: result.status,
        note: result.note,
        by: result.by,
        at: result.at,
      });
      window.setTimeout(() => {
        void Promise.resolve(
          onPersist?.({ reason: 'drawing-review-decision', taskId: task.id })
        ).catch(() => {});
      }, 120);
      toast?.(`Drawing ${result.status.toLowerCase()}`, 'ok');
      setDecision('');
      setNote('');
    } catch (e) {
      toast?.(e?.message || 'Drawing decision failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="dap-panel">
      <div className="dap-head">
        <div>
          <span className="dap-eyebrow">Design Head approval</span>
          <h3>{review.title || 'Drawing review'}</h3>
          <p>
            {review.projectPhase || 'Project phase not set'} · {review.building || 'All buildings'} ·{' '}
            {review.drawingType || 'Drawing'}{review.subDrawing ? ` · ${review.subDrawing}` : ''} · V
            {review.version || 1}
          </p>
        </div>
        <span className={`dap-status dap-status-${String(review.status || 'for-review').toLowerCase().replace(/\s+/g, '-')}`}>
          {review.status || 'For review'}
        </span>
      </div>

      <div className="dap-links">
        <a href={review.url} target="_blank" rel="noopener noreferrer" className="btp">
          Review drawing ↗
        </a>
        {onOpenProject ? (
          <button type="button" className="btg" onClick={() => onOpenProject(proj.id, 'drawings')}>
            Open project Drawings
          </button>
        ) : null}
      </div>

      {review.decisionNote ? (
        <div className="dap-last">
          <strong>Latest decision:</strong> {review.status} by {review.decisionBy || 'Design Head'}
          {review.decisionNote ? <p>{review.decisionNote}</p> : null}
        </div>
      ) : null}

      <div className="dap-decisions">
        {DECISIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`dap-choice ${d.className}${decision === d.id ? ' active' : ''}`}
            onClick={() => setDecision(d.id)}
            disabled={busy}
          >
            {d.label}
          </button>
        ))}
      </div>
      {decision ? (
        <div className="dap-compose">
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              decision === 'approve'
                ? 'Approval note (optional)'
                : 'Required: describe the changes or rejection reason'
            }
          />
          <button type="button" className="btp" disabled={busy} onClick={submit}>
            {busy ? 'Saving decision…' : 'Confirm decision'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
