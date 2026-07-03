import { useMemo, useState } from 'react';
import {
  buildComplianceItems,
  COMPLIANCE_KIND_LABELS,
  complianceToCsv,
  filterComplianceItems,
} from './preconCompliance.js';
import { formatShortDate } from './preconMyWork.js';
import { statusLabel } from './preconTaskStatus.js';
import { todayIso } from './preconTaskStatus.js';

const C = {
  navy: '#1A304A',
  tx2: '#55504A',
  tx3: '#96918A',
  red: '#B32E1E',
  gold: '#9A6E20',
};

export function DashboardComplianceView({ projects = [], onOpenProject }) {
  const todayStr = todayIso();
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState('');

  const allItems = useMemo(() => buildComplianceItems(projects, todayStr), [projects, todayStr]);
  const filtered = useMemo(
    () => filterComplianceItems(allItems, { projectId, query, kind }),
    [allItems, projectId, query, kind],
  );

  const stats = useMemo(() => {
    let schedule = 0;
    let nextAction = 0;
    const byProject = new Map();
    for (const row of allItems) {
      if (row.breaches?.some((b) => b.kind === 'schedule')) schedule += 1;
      if (row.breaches?.some((b) => b.kind === 'next_action')) nextAction += 1;
      const pid = row.proj?.id;
      if (pid) byProject.set(pid, (byProject.get(pid) || 0) + 1);
    }
    return { schedule, nextAction, byProject, total: allItems.length };
  }, [allItems]);

  const downloadCsv = () => {
    const stamp = todayStr;
    const blob = new Blob([complianceToCsv(filtered)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `GA_PreCon_Compliance_${stamp}.csv`;
    a.click();
  };

  return (
    <div className="dash-compliance">
      <div className="dash-reports-head">
        <div>
          <h2 className="disp" style={{ fontSize: 20, fontWeight: 600, color: C.navy, margin: 0 }}>
            Process compliance
          </h2>
          <p style={{ fontSize: 12, color: C.tx2, marginTop: 6, lineHeight: 1.55, maxWidth: 640 }}>
            Open tasks that missed a <strong>schedule due date</strong> or <strong>next action date</strong> without
            extending either to today or a future date. Completing the task, pausing it, or posting a new next-action
            date clears the item from this list.
          </p>
        </div>
        <div className="dash-reports-dl">
          <button type="button" className="btg" onClick={downloadCsv} disabled={!filtered.length}>
            Download CSV
          </button>
        </div>
      </div>

      <div className="dash-reports-stats">
        <div className="dash-reports-stat dash-reports-stat-alert">
          <span className="dash-reports-stat-n disp">{stats.total}</span>
          <span className="dash-reports-stat-l">Non-compliant tasks</span>
        </div>
        <div className="dash-reports-stat">
          <span className="dash-reports-stat-n disp">{stats.schedule}</span>
          <span className="dash-reports-stat-l">Schedule overdue</span>
        </div>
        <div className="dash-reports-stat">
          <span className="dash-reports-stat-n disp">{stats.nextAction}</span>
          <span className="dash-reports-stat-l">Next action overdue</span>
        </div>
        <div className="dash-reports-stat wide">
          <span className="dash-reports-stat-l" style={{ marginBottom: 6 }}>
            By project
          </span>
          <div className="dash-reports-chips">
            {stats.total ? (
              [...stats.byProject.entries()].map(([pid, n]) => {
                const p = projects.find((x) => x.id === pid);
                return (
                  <span key={pid} className="dash-reports-chip dash-reports-chip-warn">
                    {p?.name || pid} · {n}
                  </span>
                );
              })
            ) : (
              <span className="dash-reports-chip" style={{ color: C.tx3 }}>
                All clear — no open breaches
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="dash-reports-filters">
        <input
          type="search"
          className="dash-proj-search"
          placeholder="Search task, assignee, project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search compliance list"
        />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Filter by project">
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by breach type">
          <option value="">All breach types</option>
          {Object.entries(COMPLIANCE_KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <span className="dash-compliance-asof">As of {formatShortDate(todayStr)}</span>
      </div>

      <div className="card dash-reports-table-wrap">
        <table className="dash-reports-table dash-compliance-table">
          <thead>
            <tr>
              <th>Days</th>
              <th>Project</th>
              <th>Task</th>
              <th>Assignee</th>
              <th>Breach</th>
              <th>Dates</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((row) => (
                <tr key={`${row.proj?.id}-${row.task?.id}`} className="dash-compliance-row">
                  <td>
                    <span className="dash-compliance-days">{row.daysOverdue}d</span>
                  </td>
                  <td>
                    <div>{row.proj?.name}</div>
                    <div style={{ fontSize: 10, color: C.tx3, marginTop: 2 }}>{row.ph?.name}</div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.task?.name}</div>
                    <div style={{ fontSize: 10, color: C.tx3, marginTop: 2 }}>{statusLabel(row.status)}</div>
                  </td>
                  <td>{row.task?.who || '—'}</td>
                  <td>
                    <div className="dash-compliance-badges">
                      {(row.breaches || []).map((b) => (
                        <span key={b.kind} className={`dash-compliance-badge dash-compliance-badge-${b.kind}`}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                    {row.nextAction ? (
                      <div style={{ fontSize: 10, color: C.tx2, marginTop: 4, lineHeight: 1.4 }}>
                        Next: {row.nextAction}
                      </div>
                    ) : null}
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {row.plannedEnd ? (
                      <div>
                        Due {formatShortDate(row.plannedEnd)}
                        {row.plannedEnd < todayStr ? ' ✗' : ''}
                      </div>
                    ) : null}
                    {row.nextActionDate ? (
                      <div style={{ marginTop: 4 }}>
                        NA {formatShortDate(row.nextActionDate)}
                        {row.nextActionDate < todayStr ? ' ✗' : ''}
                      </div>
                    ) : (
                      <div style={{ marginTop: 4, color: C.tx3 }}>No next-action date</div>
                    )}
                  </td>
                  <td>
                    {onOpenProject ? (
                      <button
                        type="button"
                        className="bts"
                        onClick={() => onOpenProject(row.proj?.id)}
                      >
                        Open
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: C.tx3, fontSize: 13 }}>
                  {stats.total === 0
                    ? 'No process compliance gaps — every open task is on track or has a future commitment.'
                    : 'No tasks match your filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
