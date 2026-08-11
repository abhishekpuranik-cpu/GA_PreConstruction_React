import React, { useEffect, useMemo, useState } from 'react';
import { TaskCommentModal } from './TaskCommentModal.jsx';
import {
  buildPhaseStripModel,
  buildTaskRows,
  findCurrentPhaseIndex,
} from './tasksViewV2Model.js';
import './tasksViewV2.css';

/**
 * Read-only V2 Tasks tab: phase strip + root-task table.
 * Must not call dispatch / onPersist / MongoSync itself.
 * Comment modal uses the same opener shape as TasksView.
 */
export function TasksViewV2({
  proj,
  dispatch,
  toast,
  departments,
  loginUser,
  assigneeRoster,
  onSaveActivity,
  onOpenProject,
}) {
  const strip = useMemo(() => buildPhaseStripModel(proj), [proj]);
  const currentIndex = useMemo(
    () => findCurrentPhaseIndex(Array.isArray(proj?.phases) ? proj.phases : []),
    [proj],
  );
  const [selectedPhaseId, setSelectedPhaseId] = useState(null);
  const [commentTarget, setCommentTarget] = useState(null);

  useEffect(() => {
    const current = strip[currentIndex];
    setSelectedPhaseId(current?.id ?? strip[0]?.id ?? null);
  }, [proj?.id]); // open on current phase when entering a project

  useEffect(() => {
    if (!strip.length) {
      setSelectedPhaseId(null);
      return;
    }
    if (selectedPhaseId && strip.some((p) => p.id === selectedPhaseId)) return;
    const current = strip[currentIndex] || strip[0];
    setSelectedPhaseId(current?.id ?? null);
  }, [strip, currentIndex, selectedPhaseId]);

  const selected = strip.find((p) => p.id === selectedPhaseId) || null;
  const rows = useMemo(
    () => (selected ? buildTaskRows(proj, selected.phase) : []),
    [proj, selected],
  );

  const authorName = loginUser?.ready ? loginUser.name || 'User' : '';
  const openCommentModal = (ph, task) => setCommentTarget({ ph, task });
  const closeCommentModal = () => setCommentTarget(null);

  return (
    <div className="precon-v2">
      <div className="precon-v2-strip-head">
        <p className="precon-v2-strip-label">Phases — select a phase to open it</p>
      </div>

      <div className="precon-v2-strip" role="list">
        {strip.map((tile) => {
          const selectedCls = tile.id === selectedPhaseId ? ' is-selected' : '';
          return (
            <button
              key={tile.id}
              type="button"
              role="listitem"
              className={`precon-v2-tile is-${tile.state}${selectedCls}`}
              onClick={() => setSelectedPhaseId(tile.id)}
            >
              <div className="precon-v2-tile-name">{tile.name}</div>
              {tile.state === 'current' && tile.metric ? (
                <div>
                  <div className={`precon-v2-tile-metric${tile.metric.tone === 'stamp' ? ' is-stamp' : ''}`}>
                    {tile.metric.value}
                  </div>
                  <span className="precon-v2-tile-metric-label">{tile.metric.label}</span>
                </div>
              ) : (
                <div aria-hidden="true" />
              )}
              <div className="precon-v2-tile-foot">
                {tile.state === 'complete' ? (
                  <>
                    ✓ all {tile.stats.total} tasks
                    {tile.owner ? ` · ${tile.owner}` : ''}
                  </>
                ) : null}
                {tile.state === 'current' ? (
                  <>
                    {tile.stats.done}/{tile.stats.total} tasks
                    {tile.owner ? ` · ${tile.owner}` : ''}
                  </>
                ) : null}
                {tile.state === 'future' ? (
                  <>
                    {tile.stats.total} tasks planned
                    {tile.owner ? ` · ${tile.owner}` : ''}
                  </>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      <div className="precon-v2-table-wrap">
        <table className="precon-v2-table">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">Verified</th>
              <th scope="col">Live next action</th>
              <th scope="col">Status</th>
              <th scope="col" aria-label="Open comments" />
            </tr>
          </thead>
          <tbody>
            {!selected || rows.length === 0 ? (
              <tr>
                <td className="precon-v2-empty" colSpan={5}>
                  No tasks in this phase yet.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const markerClass =
                  row.status === 'Met' ? 'is-met' : row.status === 'Overdue' ? 'is-overdue' : 'is-open';
                const marker = row.status === 'Met' ? '✓' : row.status === 'Overdue' ? '!' : '○';
                const chipClass =
                  row.status === 'Met' ? 'is-met' : row.status === 'Overdue' ? 'is-overdue' : '';
                return (
                  <tr key={row.task.id}>
                    <td>
                      <div className="precon-v2-task">
                        <span className={`precon-v2-marker ${markerClass}`} aria-hidden>
                          {marker}
                        </span>
                        <div>
                          <div className="precon-v2-task-name">{row.task.name || '—'}</div>
                          <div className="precon-v2-task-meta">
                            {row.who || '—'}
                            {' · '}
                            {row.commentCount} comment{row.commentCount === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="precon-v2-verified">
                        {row.verified.x}/{row.verified.y}
                      </span>
                    </td>
                    <td>
                      <div className="precon-v2-next">
                        <div className={`precon-v2-next-text${row.next.text ? '' : ' precon-v2-muted'}`}>
                          {row.next.text || '—'}
                        </div>
                        {row.next.due ? (
                          <div className={`precon-v2-next-due${row.duePast ? ' is-past' : ''}`}>
                            Due {row.next.due}
                          </div>
                        ) : row.next.text ? (
                          <div className="precon-v2-next-due precon-v2-muted">Due —</div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={`precon-v2-chip ${chipClass}`}>{row.status}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="precon-v2-open"
                        onClick={() => openCommentModal(selected.phase, row.task)}
                      >
                        Open comments →
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <TaskCommentModal
        open={!!commentTarget}
        onClose={closeCommentModal}
        proj={proj}
        ph={commentTarget?.ph}
        task={commentTarget?.task}
        dispatch={dispatch}
        toast={toast}
        authorName={authorName}
        authorEmail={loginUser?.email}
        departments={departments}
        assigneeOptions={assigneeRoster}
        onOpenProject={onOpenProject}
        onPersist={onSaveActivity}
      />
    </div>
  );
}
