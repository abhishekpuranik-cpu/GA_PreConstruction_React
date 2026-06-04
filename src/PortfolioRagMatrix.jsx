import React, { useMemo, useState, useCallback } from 'react';
import {
  PORTFOLIO_PHASE_COLUMNS,
  RAG_COLORS,
  buildPortfolioMatrix,
  computePortfolioMetrics,
} from './preconPortfolioRag.js';
import { fmt } from './preconPortfolioFormat.js';

const C = {
  navy: '#1A304A',
  tx2: '#55504A',
  tx3: '#96918A',
  bd: '#E2DDD4',
  gold: '#9A6E20',
};

function RagLegend() {
  return (
    <div className="rag-legend">
      {(['green', 'amber', 'red', 'gray', 'na']).map((k) => (
        <span key={k} className="rag-leg-item">
          <span className="rag-leg-swatch" style={{ background: RAG_COLORS[k].bg }} />
          {RAG_COLORS[k].label}
        </span>
      ))}
    </div>
  );
}

function RagTooltip({ tip, pos }) {
  if (!tip) return null;
  const cell = tip.cell;
  const x = Math.min(pos.x + 16, window.innerWidth - 320);
  const y = Math.min(pos.y + 16, window.innerHeight - 280);

  return (
    <div className="rag-tooltip" style={{ left: x, top: y }} role="tooltip">
      <div className="rag-tt-title">
        {tip.projName}
        <span className="rag-tt-phase">{tip.columnLabel}</span>
      </div>
      <div className="rag-tt-rag" style={{ color: RAG_COLORS[cell.rag]?.bg }}>
        {RAG_COLORS[cell.rag]?.label} · {cell.summary}
      </div>
      {cell.dept && (
        <div className="rag-tt-row">
          <span className="rag-tt-k">Department</span>
          <span>
            {cell.dept.name} ({cell.dept.head})
          </span>
        </div>
      )}
      {cell.current ? (
        <div className="rag-tt-block">
          <div className="rag-tt-k">Current activity</div>
          <div className="rag-tt-v">{cell.current.task?.name}</div>
          <div className="rag-tt-meta">
            {cell.current.label}
            {cell.current.end ? ` · End ${fmt(cell.current.end)}` : ''}
            {cell.current.overdueDays > 0 ? ` · ${cell.current.overdueDays}d overdue` : ''}
          </div>
        </div>
      ) : (
        <div className="rag-tt-block">
          <div className="rag-tt-k">Current activity</div>
          <div className="rag-tt-meta">—</div>
        </div>
      )}
      {cell.issue ? (
        <div className={`rag-tt-block${cell.issue.flagged ? ' rag-tt-issue-flag' : ''}`}>
          <div className="rag-tt-k">{cell.issue.flagged ? 'Flagged issue' : 'Latest comment'}</div>
          <div className="rag-tt-v">{cell.issue.text}</div>
          {cell.issue.nextAction ? (
            <div className="rag-tt-meta">
              Next: {cell.issue.nextAction}
              {cell.issue.nextActionDate ? ` · ${cell.issue.nextActionDate}` : ''}
            </div>
          ) : null}
          <div className="rag-tt-meta">
            {cell.issue.author}
            {cell.issue.ts ? ` · ${cell.issue.ts}` : ''}
          </div>
        </div>
      ) : (
        <div className="rag-tt-block">
          <div className="rag-tt-k">Latest comment</div>
          <div className="rag-tt-meta">No comments logged</div>
        </div>
      )}
      <div className="rag-tt-foot">{cell.pct}% complete ({cell.completed}/{cell.total} tasks)</div>
    </div>
  );
}

export function PortfolioRagMatrix({ projects, departments, onOpenProject }) {
  const metrics = useMemo(
    () => computePortfolioMetrics(projects, departments),
    [projects, departments]
  );
  const [tip, setTip] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });

  const showTip = useCallback((e, proj, col, cell) => {
    setTipPos({ x: e.clientX, y: e.clientY });
    setTip({
      projName: proj.name,
      columnLabel: col.label,
      cell,
    });
  }, []);

  const hideTip = useCallback(() => setTip(null), []);

  return (
    <div className="rag-section card">
      <div className="rag-head">
        <div>
          <h2 className="disp rag-title">Portfolio progress (RAG)</h2>
          <p className="rag-sub">
            Lifecycle health by project and phase — hover for current activity and latest comment
          </p>
        </div>
        <RagLegend />
      </div>

      <div className="rag-metrics">
        {[
          { l: 'Portfolio completion', v: `${metrics.portfolioPct}%`, c: C.navy },
          { l: 'On-time (active tasks)', v: `${metrics.onTimePct}%`, c: metrics.onTimePct >= 85 ? '#1A6A3C' : '#AE6418' },
          { l: 'Projects at risk', v: metrics.atRiskCount, c: metrics.atRiskCount ? '#B32E1E' : '#1A6A3C' },
          { l: 'RAG — On track', v: metrics.green, c: '#1A6A3C', sub: `of ${metrics.green + metrics.amber + metrics.red + metrics.gray} cells` },
          { l: 'RAG — At risk', v: metrics.amber, c: '#AE6418' },
          { l: 'RAG — Off track', v: metrics.red, c: '#B32E1E' },
          { l: 'Flagged issues', v: metrics.flaggedIssues, c: metrics.flaggedIssues ? '#B32E1E' : '#1A6A3C' },
          { l: 'Overdue tasks', v: metrics.overdueTasks, c: metrics.overdueTasks ? '#B32E1E' : '#1A6A3C' },
        ].map((k, i) => (
          <div key={i} className="rag-metric" style={{ borderLeftColor: k.c }}>
            <div className="rag-metric-l">{k.l}</div>
            <div className="rag-metric-v" style={{ color: k.c }}>
              {k.v}
            </div>
            {k.sub && <div className="rag-metric-s">{k.sub}</div>}
          </div>
        ))}
      </div>

      <div className="rag-scroll">
        <table className="rag-table">
          <thead>
            <tr>
              <th className="rag-th-proj">Project</th>
              {PORTFOLIO_PHASE_COLUMNS.map((col) => (
                <th key={col.id} className="rag-th-phase" title={col.label}>
                  <span className="rag-th-text">{col.short}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.matrix.map((row) => (
              <tr key={row.proj.id}>
                <td className="rag-td-proj">
                  <button
                    type="button"
                    className="rag-proj-btn"
                    onClick={() => onOpenProject?.(row.proj.id)}
                  >
                    <span className="rag-proj-name">{row.proj.name}</span>
                    <span className="rag-proj-meta">{row.proj.loc || row.proj.status}</span>
                  </button>
                </td>
                {row.cells.map(({ column, ...cell }) => (
                  <td key={column.id} className="rag-td-cell">
                    <button
                      type="button"
                      className={`rag-cell rag-${cell.rag}`}
                      style={{
                        background: RAG_COLORS[cell.rag]?.bg,
                        borderColor: RAG_COLORS[cell.rag]?.border,
                      }}
                      onMouseEnter={(e) => showTip(e, row.proj, column, cell)}
                      onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
                      onMouseLeave={hideTip}
                      onClick={() => onOpenProject?.(row.proj.id)}
                      aria-label={`${row.proj.name} ${column.label}: ${RAG_COLORS[cell.rag].label}`}
                    >
                      {cell.rag !== 'na' && (
                        <span className="rag-cell-pct">{cell.pct}%</span>
                      )}
                      {cell.flagged > 0 && <span className="rag-cell-flag" title="Flagged comment" />}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RagTooltip tip={tip} pos={tipPos} />
    </div>
  );
}

export { computePortfolioMetrics };
