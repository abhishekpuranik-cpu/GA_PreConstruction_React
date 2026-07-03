import { useMemo, useState } from 'react';
import {
  activityLogToCsv,
  filterActivityLog,
  formatActivityAction,
  ACTIVITY_ACTION_LABELS,
} from './preconActivityLog.js';

const C = {
  navy: '#1A304A',
  tx2: '#55504A',
  tx3: '#96918A',
};

function fmtTs(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function DashboardActivityReport({ activityLog = [], projects = [] }) {
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filtered = useMemo(
    () => filterActivityLog(activityLog, { query, projectId, action, from, to }),
    [activityLog, query, projectId, action, from, to],
  );

  const stats = useMemo(() => {
    const byAction = {};
    const byActor = {};
    for (const row of filtered) {
      byAction[row.action] = (byAction[row.action] || 0) + 1;
      const who = row.actor || 'Unknown';
      byActor[who] = (byActor[who] || 0) + 1;
    }
    const topActors = Object.entries(byActor)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    const topActions = Object.entries(byAction)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, n]) => ({ label: formatActivityAction(k), n }));
    return { topActors, topActions, total: filtered.length };
  }, [filtered]);

  const download = (kind) => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === 'csv') {
      const blob = new Blob([activityLogToCsv(filtered)], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `GA_PreCon_Activity_${stamp}.csv`;
      a.click();
      return;
    }
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `GA_PreCon_Activity_${stamp}.json`;
    a.click();
  };

  return (
    <div className="dash-reports">
      <div className="dash-reports-head">
        <div>
          <h2 className="disp" style={{ fontSize: 20, fontWeight: 600, color: C.navy, margin: 0 }}>
            Activity log
          </h2>
          <p style={{ fontSize: 12, color: C.tx2, marginTop: 6, lineHeight: 1.5 }}>
            Timestamped audit of task, comment, project, and schedule changes across the workspace.
          </p>
        </div>
        <div className="dash-reports-dl">
          <button type="button" className="btg" onClick={() => download('csv')} disabled={!filtered.length}>
            Download CSV
          </button>
          <button type="button" className="btp" onClick={() => download('json')} disabled={!filtered.length}>
            Download JSON
          </button>
        </div>
      </div>

      <div className="dash-reports-stats">
        <div className="dash-reports-stat">
          <span className="dash-reports-stat-n disp">{stats.total}</span>
          <span className="dash-reports-stat-l">Matching events</span>
        </div>
        <div className="dash-reports-stat">
          <span className="dash-reports-stat-n disp">{activityLog.length}</span>
          <span className="dash-reports-stat-l">Total logged</span>
        </div>
        <div className="dash-reports-stat wide">
          <span className="dash-reports-stat-l" style={{ marginBottom: 6 }}>
            Top contributors
          </span>
          <div className="dash-reports-chips">
            {stats.topActors.length
              ? stats.topActors.map(([name, n]) => (
                  <span key={name} className="dash-reports-chip">
                    {name} · {n}
                  </span>
                ))
              : <span style={{ fontSize: 11, color: C.tx3 }}>No activity yet</span>}
          </div>
        </div>
        <div className="dash-reports-stat wide">
          <span className="dash-reports-stat-l" style={{ marginBottom: 6 }}>
            By type
          </span>
          <div className="dash-reports-chips">
            {stats.topActions.map((x) => (
              <span key={x.label} className="dash-reports-chip">
                {x.label} · {x.n}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="dash-reports-filters">
        <input
          type="search"
          className="dash-proj-search"
          placeholder="Search summary, actor, project, task…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search activity log"
        />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter by project">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action type">
          <option value="">All actions</option>
          {Object.entries(ACTIVITY_ACTION_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>

      <div className="card dash-reports-table-wrap">
        <table className="dash-reports-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Type</th>
              <th>Project</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{fmtTs(row.at)}</td>
                  <td>{row.actor || '—'}</td>
                  <td>
                    <span className="dash-reports-type">{formatActivityAction(row.action)}</span>
                  </td>
                  <td>
                    <div>{row.projectName || '—'}</div>
                    {row.phaseName ? (
                      <div style={{ fontSize: 10, color: C.tx3, marginTop: 2 }}>{row.phaseName}</div>
                    ) : null}
                  </td>
                  <td>
                    <div>{row.summary}</div>
                    {row.taskName ? (
                      <div style={{ fontSize: 10, color: C.tx3, marginTop: 2 }}>{row.taskName}</div>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 28, color: C.tx3, fontSize: 13 }}>
                  No activity matches your filters. Changes you make on project tasks, comments, and settings appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
