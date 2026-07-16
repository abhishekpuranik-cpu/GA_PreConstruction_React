import React from 'react';

function ProgressRing({ pct, accent, size = 92 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="pj-ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(26,48,74,.1)" strokeWidth="7" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={accent}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="pj-ring-label">
        <span className="pj-ring-pct">{pct}%</span>
        <span className="pj-ring-sub">complete</span>
      </div>
    </div>
  );
}

const TABS = [
  { id: 'tasks', label: 'Tasks & schedule' },
  { id: 'allocate', label: 'Bulk allocate' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'regs', label: 'Regulatory' },
];

/**
 * Premium project page chrome: hero, stats, tabs, workspace shell.
 */
export function ProjectPageShell({
  project,
  stats,
  activeTab,
  onTabChange,
  onKickoffChange,
  onAddPhase,
  onEditProject,
  onDeleteProject,
  canDeleteProjects,
  children,
}) {
  const accent = project.col || '#1A304A';

  return (
    <div className="proj-page" style={{ '--pj-accent': accent }}>
      <header className="pj-hero">
        <div className="pj-hero-bg" aria-hidden />
        <div className="pj-hero-body">
          <div className="pj-hero-main">
            <div className="pj-hero-tags">
              <span className="pj-tag pj-tag-status">{project.status || 'Pre-Construction'}</span>
              <span className="pj-tag">{project.type || 'Project'}</span>
              {project.loc ? <span className="pj-tag pj-tag-loc">{project.loc}</span> : null}
            </div>
            <h1 className="pj-hero-title">{project.name}</h1>
            <p className="pj-hero-sub">
              {project.floors ? `${project.floors} floors` : null}
              {project.floors && stats?.tot ? ' · ' : null}
              {stats?.tot ? `${stats.tot} tasks across ${project.phases?.length || 0} phases` : null}
            </p>
            <div className="pj-hero-ko">
              <label htmlFor={`ko-${project.id}`}>Kickoff date</label>
              <input
                id={`ko-${project.id}`}
                type="date"
                className="pj-ko-input"
                defaultValue={project.ko}
                onChange={(e) => onKickoffChange?.(e.target.value)}
              />
              <span className="pj-hero-ko-hint">Updates planned dates for all scheduled tasks</span>
            </div>
          </div>

          <div className="pj-hero-aside">
            <ProgressRing pct={stats?.pct ?? 0} accent={accent} />
            <div className="pj-stat-grid">
              <div className="pj-stat pj-stat-done">
                <span className="pj-stat-val">{stats?.comp ?? 0}</span>
                <span className="pj-stat-lbl">Done</span>
              </div>
              <div className="pj-stat pj-stat-active">
                <span className="pj-stat-val">{stats?.ip ?? 0}</span>
                <span className="pj-stat-lbl">Active</span>
              </div>
              <div className="pj-stat pj-stat-late">
                <span className="pj-stat-val">{stats?.ov ?? 0}</span>
                <span className="pj-stat-lbl">Overdue</span>
              </div>
              <div className="pj-stat pj-stat-up">
                <span className="pj-stat-val">{stats?.up ?? 0}</span>
                <span className="pj-stat-lbl">Upcoming</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pj-hero-foot">
          <div className="pj-hero-foot-hint">Pre-construction command centre for this project</div>
          <div className="pj-hero-actions">
            <button type="button" className="pj-btn pj-btn-ghost" onClick={onAddPhase}>
              + Phase
            </button>
            <button type="button" className="pj-btn pj-btn-ghost" onClick={onEditProject}>
              Edit project
            </button>
            {canDeleteProjects ? (
              <button type="button" className="pj-btn pj-btn-danger" onClick={onDeleteProject}>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <section className="pj-workspace">
        <div className="pj-tabs" role="tablist" aria-label="Project views">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`pj-tab${activeTab === id ? ' pj-tab-active' : ''}`}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pj-workspace-body">{children}</div>
      </section>
    </div>
  );
}
