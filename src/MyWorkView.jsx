import React, { useEffect, useMemo, useState } from 'react';
import { collectAssignees } from './preconExport.js';
import { getDepartmentForPhase } from './preconDepartments.js';
import { statusLabel, statusBadgeClass } from './preconTaskStatus.js';
import {
  assigneeMatches,
  buildMyWorkItems,
  formatShortDate,
  groupMyWorkItems,
  myWorkSummary,
} from './preconMyWork.js';

const SCOL = {
  completed: '#1A6A3C',
  inprogress: '#1B5E9E',
  overdue: '#B32E1E',
  notstarted: '#9A9590',
  paused: '#AE6418',
};

const GROUP_ACCENT = {
  overdue: '#B32E1E',
  today: '#9A6E20',
  week: '#1B5E9E',
  later: '#1A304A',
  nodate: '#6A6560',
  done: '#1A6A3C',
};

function WorkCard({ item, onOpenProject }) {
  const { proj, ph, task, st, sortDate, sortSource, label, nextAction, overdueDays } = item;
  const accent = SCOL[st] || '#1A304A';

  return (
    <article className="mw-card" style={{ '--mw-accent': accent }}>
      <div className="mw-card-top">
        <button
          type="button"
          className="mw-proj-link"
          onClick={() => onOpenProject(proj.id)}
          title={`Open ${proj.name}`}
        >
          {proj.name}
        </button>
        <span className={`badge ${statusBadgeClass(st)}`}>{statusLabel(st)}</span>
      </div>
      <h3 className="mw-task-name">{task.name}</h3>
      <div className="mw-meta-row">
        <span className="mw-phase" style={{ borderColor: ph.col, color: ph.col }}>
          {ph.name}
        </span>
        {proj.loc ? <span className="mw-loc">{proj.loc}</span> : null}
      </div>
      <div className="mw-date-row">
        <span className="mw-date-lbl">{label}</span>
        <span className={`mw-date-val${overdueDays > 0 ? ' mw-date-late' : ''}`}>
          {formatShortDate(sortDate)}
          {overdueDays > 0 ? ` · ${overdueDays}d late` : ''}
        </span>
        {sortSource === 'next_action' ? <span className="mw-date-tag">From comment</span> : null}
      </div>
      {nextAction?.nextAction ? (
        <div className="mw-next">
          <span className="mw-next-k">Next</span>
          <span className="mw-next-v">{nextAction.nextAction}</span>
        </div>
      ) : null}
      {nextAction?.commentSnippet ? (
        <p className="mw-snippet">{nextAction.commentSnippet}</p>
      ) : null}
      <button type="button" className="mw-open-btn" onClick={() => onOpenProject(proj.id)}>
        Open in project →
      </button>
    </article>
  );
}

export function MyWorkView({ projects, loginUser, departments, onOpenProject }) {
  const assignees = useMemo(() => collectAssignees(projects), [projects]);
  const defaultPerson = loginUser?.ready ? loginUser.name || '' : '';
  const [person, setPerson] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(true);

  useEffect(() => {
    if (loginUser?.ready && loginUser.name) setPerson(loginUser.name);
  }, [loginUser?.ready, loginUser?.name]);

  const effectivePerson = person || defaultPerson;
  const { items, todayStr } = useMemo(
    () => buildMyWorkItems(projects, effectivePerson),
    [projects, effectivePerson]
  );
  const filtered = useMemo(
    () => (hideCompleted ? items.filter((i) => i.st !== 'completed') : items),
    [items, hideCompleted]
  );
  const groups = useMemo(() => groupMyWorkItems(filtered, todayStr), [filtered, todayStr]);
  const summary = useMemo(() => myWorkSummary(items, todayStr), [items, todayStr]);
  const displayGroups = showDone ? groups : groups.filter((g) => g.id !== 'done');

  return (
    <div className="mywork">
      <header className="mw-hero">
        <div className="mw-hero-inner">
          <p className="mw-eyebrow">Personal workboard</p>
          <h1 className="mw-title disp">My Work</h1>
          <p className="mw-sub">
            Every task assigned to you, across all projects — ordered by next action date, then planned
            due dates.
          </p>
          {loginUser?.ready ? (
            <p className="mw-signed">
              Signed in as <strong>{loginUser.name}</strong>
              {loginUser.email ? ` · ${loginUser.email}` : ''}
            </p>
          ) : null}
        </div>
        <div className="mw-stats">
          <div className="mw-stat mw-stat-risk">
            <span className="mw-stat-n disp">{summary.overdue}</span>
            <span className="mw-stat-l">Overdue</span>
          </div>
          <div className="mw-stat mw-stat-today">
            <span className="mw-stat-n disp">{summary.today}</span>
            <span className="mw-stat-l">Due today</span>
          </div>
          <div className="mw-stat">
            <span className="mw-stat-n disp">{summary.week}</span>
            <span className="mw-stat-l">This week</span>
          </div>
          <div className="mw-stat">
            <span className="mw-stat-n disp">{summary.total}</span>
            <span className="mw-stat-l">Open tasks</span>
          </div>
          <div className="mw-stat">
            <span className="mw-stat-n disp">{summary.projects}</span>
            <span className="mw-stat-l">Projects</span>
          </div>
        </div>
      </header>

      <div className="mw-toolbar card">
        <div className="mw-toolbar-field">
          <label htmlFor="mw-person">View work for</label>
          <select
            id="mw-person"
            className="mw-select"
            value={effectivePerson}
            onChange={(e) => setPerson(e.target.value)}
          >
            {!assignees.includes(defaultPerson) && defaultPerson ? (
              <option value={defaultPerson}>{defaultPerson} (you)</option>
            ) : null}
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a}
                {assigneeMatches(a, defaultPerson) ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
        <label className="mw-check">
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed
        </label>
        {!hideCompleted ? (
          <label className="mw-check">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show completed section
          </label>
        ) : null}
        <span className="mw-toolbar-hint">
          Tip: set <strong>Assignee</strong> on tasks and log <strong>Next action + date</strong> on comments
          to drive this timeline.
        </span>
      </div>

      {!effectivePerson ? (
        <div className="mw-empty card">
          <p>Sign in via the platform vault to load your name, or pick an assignee above.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mw-empty card">
          <div className="mw-empty-icon" aria-hidden>
            ✓
          </div>
          <h2 className="disp">All clear</h2>
          <p>
            No open tasks are assigned to <strong>{effectivePerson}</strong> across {projects.length}{' '}
            project{projects.length !== 1 ? 's' : ''}.
          </p>
        </div>
      ) : (
        <div className="mw-timeline">
          {displayGroups.map((group) => (
            <section key={group.id} className="mw-group">
              <div className="mw-group-head" style={{ '--mw-g': GROUP_ACCENT[group.id] }}>
                <div>
                  <h2 className="mw-group-title">{group.title}</h2>
                  <p className="mw-group-hint">{group.hint}</p>
                </div>
                <span className="mw-group-count">{group.items.length}</span>
              </div>
              <div className="mw-cards">
                {group.items.map((item) => {
                  const dept = getDepartmentForPhase(item.ph.name, departments);
                  return (
                    <div key={`${item.proj.id}-${item.task.id}`} className="mw-card-wrap">
                      {dept ? (
                        <span className="mw-dept" title={dept.head}>
                          {dept.name}
                        </span>
                      ) : null}
                      <WorkCard item={item} onOpenProject={onOpenProject} />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
