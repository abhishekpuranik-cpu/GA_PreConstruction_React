import React, { useEffect, useMemo, useState } from 'react';
import { buildPhaseStripModel, findCurrentPhaseIndex } from './tasksViewV2Model.js';
import './phaseStrip.css';

const COLLAPSE_KEY = 'PRECON_V2_PHASE_STRIP_COLLAPSED';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Phase navigator strip (D17/D20/D21).
 * Writes: only dispatch({ type: 'addPhase', projId }) from + Phase tile.
 * Selection stays local; injects visiblePhaseId into a single child TasksView (D19 context bar lives there).
 */
export function PhaseStrip({ proj, dispatch, children }) {
  const strip = useMemo(() => buildPhaseStripModel(proj), [proj]);
  const currentIndex = useMemo(
    () => findCurrentPhaseIndex(strip.map((t) => t.phase)),
    [strip],
  );
  const [selectedPhaseId, setSelectedPhaseId] = useState(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  useEffect(() => {
    const current = strip[currentIndex];
    setSelectedPhaseId(current?.id ?? strip[0]?.id ?? null);
  }, [proj?.id]);

  useEffect(() => {
    if (!strip.length) {
      setSelectedPhaseId(null);
      return;
    }
    if (selectedPhaseId && strip.some((p) => p.id === selectedPhaseId)) return;
    const current = strip[currentIndex] || strip[0];
    setSelectedPhaseId(current?.id ?? null);
  }, [strip, currentIndex, selectedPhaseId]);

  const visiblePhaseId =
    selectedPhaseId && strip.some((p) => p.id === selectedPhaseId)
      ? selectedPhaseId
      : strip[currentIndex]?.id ?? strip[0]?.id ?? null;

  const onToggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? 'true' : 'false');
      } catch {
        /* private mode */
      }
      return next;
    });
  };

  const onSelectTile = (tile) => {
    setSelectedPhaseId(tile.id);
  };

  const onAddPhase = () => {
    if (!proj?.id || typeof dispatch !== 'function') return;
    dispatch({ type: 'addPhase', projId: proj.id });
  };

  const listChild =
    React.isValidElement(children)
      ? React.cloneElement(children, { visiblePhaseId })
      : children;

  return (
    <div className={`phase-navigator-layout${collapsed ? ' is-strip-collapsed' : ''}`}>
      <main className="phase-navigator-main">{listChild}</main>
      <aside className={`phase-strip${collapsed ? ' is-collapsed' : ''}`}>
        <div className="phase-strip-head">
          <p className="phase-strip-label">Phases — select a phase</p>
          <button type="button" className="phase-strip-collapse" onClick={onToggleCollapse}>
            {collapsed ? 'Show strip' : 'Hide strip'}
          </button>
        </div>

        <div className="phase-strip-grid" role="list">
          {strip.map((tile) => {
            const selected = tile.id === visiblePhaseId;
            return (
              <button
                key={tile.id}
                type="button"
                role="listitem"
                className={`phase-strip-tile is-${tile.state}${selected ? ' is-selected' : ''}`}
                onClick={() => onSelectTile(tile)}
              >
                <div className="phase-strip-tile-name">{tile.name}</div>
                {tile.state === 'current' && tile.metric ? (
                  <div>
                    <div
                      className={`phase-strip-tile-metric${tile.metric.tone === 'danger' ? ' is-danger' : ''}`}
                    >
                      {tile.metric.value}
                    </div>
                    <span className="phase-strip-tile-metric-label">{tile.metric.label}</span>
                  </div>
                ) : (
                  <div aria-hidden="true" style={{ minHeight: 28 }} />
                )}
                <div className="phase-strip-tile-foot">
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
          <button type="button" className="phase-strip-tile phase-strip-add" onClick={onAddPhase}>
            <span className="phase-strip-add-mark" aria-hidden>
              +
            </span>
            Phase
          </button>
        </div>
      </aside>
    </div>
  );
}
