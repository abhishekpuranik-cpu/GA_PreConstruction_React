import React, { useMemo } from 'react';
import { sortCommentsNewestFirst } from './preconComments.js';
import { formatShortDate } from './preconMyWork.js';

function truncate(text, max = 120) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function CommentInlineList({ comments }) {
  const sorted = sortCommentsNewestFirst(comments);
  if (!sorted.length) {
    return <span className="clv-no-cmt">No comments</span>;
  }
  return (
    <ul className="clv-cmt-lines">
      {sorted.map(({ comment: cm }, index) => (
        <li
          key={`${cm.createdAt || ''}-${cm.ts || ''}-${cm.author || 'anon'}-${index}`}
          className={`clv-cmt-line${cm.flag ? ' clv-cmt-line-flag' : ''}`}
        >
          <span className="clv-cmt-meta">
            {cm.ts || '—'} · <strong>{cm.author || 'Anon'}</strong>
            {cm.flag ? <span className="clv-cmt-flag">Issue</span> : null}
          </span>
          <span className="clv-cmt-text">{cm.text}</span>
          {cm.nextAction || cm.nextActionDate ? (
            <span className="clv-cmt-next">
              Next: {cm.nextAction || '—'}
              {cm.nextActionDate ? ` · Due ${formatShortDate(cm.nextActionDate)}` : ''}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Flat list/table of filtered tasks and all their comments (project-wide).
 */
export function TaskCommentsListSection({
  proj,
  dm,
  filters,
  filtersActive,
  taskPassesFilters,
  statusLabel,
  taskStatus,
  fmt,
  onOpenComments,
  showOnlyWithComments,
  setShowOnlyWithComments,
}) {
  const stats = useMemo(() => {
    let filteredTasks = 0;
    let withComments = 0;
    let totalComments = 0;
    const rows = [];

    proj.phases.forEach((ph) => {
      ph.tasks.forEach((t) => {
        if (!taskPassesFilters(t, dm, ph.name, filters)) return;
        filteredTasks += 1;
        const cc = (t.comments || []).length;
        if (cc > 0) {
          withComments += 1;
          totalComments += cc;
        }
        if (showOnlyWithComments && cc === 0) return;
        rows.push({
          ph,
          task: t,
          seqIdx: ph.tasks.findIndex((x) => x.id === t.id) + 1,
          commentCount: cc,
          endDate: (dm[t.id] || {}).e || '',
          status: taskStatus(t, dm),
        });
      });
    });

    return { filteredTasks, withComments, totalComments, rows };
  }, [proj, dm, filters, showOnlyWithComments, taskPassesFilters, taskStatus]);

  const { filteredTasks, withComments, totalComments, rows } = stats;

  return (
    <div className="clv-panel">
      <div className="clv-head">
        <div>
          <h3 className="clv-title">All task comments</h3>
          <p className="clv-meta">
            {filteredTasks} filtered task{filteredTasks !== 1 ? 's' : ''} · {withComments} with comments ·{' '}
            {totalComments} comment{totalComments !== 1 ? 's' : ''}
            {filtersActive ? ' · filters applied' : ''}
          </p>
        </div>
        <label className="clv-toggle">
          <input
            type="checkbox"
            checked={showOnlyWithComments}
            onChange={(e) => setShowOnlyWithComments(e.target.checked)}
          />
          Only tasks with comments
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="clv-empty">
          {showOnlyWithComments
            ? 'No comments on tasks matching your current filters.'
            : 'No tasks match your current filters.'}
        </p>
      ) : (
        <div className="clv-wrap">
          <table className="clv-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th style={{ width: 32 }}>#</th>
                <th>Task</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Comments</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ ph, task, seqIdx, commentCount, endDate, status }) => (
                <tr key={task.id} className="clv-row">
                  <td className="clv-phase" title={ph.name}>
                    {truncate(ph.name, 28)}
                  </td>
                  <td className="clv-num">{seqIdx}</td>
                  <td className="clv-task">
                    <span className="clv-task-name">{task.name}</span>
                    {endDate ? <span className="clv-task-due">Due {fmt(endDate)}</span> : null}
                  </td>
                  <td className="clv-st">{statusLabel(status)}</td>
                  <td className="clv-who">{task.who || '—'}</td>
                  <td className="clv-comments">
                    <CommentInlineList comments={task.comments} />
                  </td>
                  <td className="clv-act">
                    <button
                      type="button"
                      className="bts tcm-open-btn"
                      onClick={() => onOpenComments?.(ph, task)}
                    >
                      {commentCount ? 'View / update' : 'Add comment'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
