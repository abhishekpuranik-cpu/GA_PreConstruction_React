import React, { useEffect, useMemo, useState } from 'react';
import { assigneeMatches, buildAssigneeRoster } from './preconAssignees.js';
import { TaskCommentPanel } from './TaskCommentPanel.jsx';
import { StatusFilterChips } from './StatusFilterChips.jsx';
import { statusLabel, statusBadgeClass } from './preconTaskStatus.js';
import { ActivityCalendarShell } from './ActivityCalendarShell.jsx';
import { fmtYmd, parseYmd, todayYmd } from './activityCalendarUtils.js';
import {
  buildMyWorkItems,
  calendarDateLabel,
  formatShortDate,
  getItemCalendarDates,
  itemMatchesCalendarDay,
  myWorkSummary,
} from './preconMyWork.js';
import './activityCalendar.css';

const SCOL = {
  completed: '#1A6A3C',
  inprogress: '#1B5E9E',
  overdue: '#B32E1E',
  notstarted: '#9A9590',
  paused: '#AE6418',
};

const LEGEND = [
  { label: 'Overdue', color: SCOL.overdue },
  { label: 'In progress', color: SCOL.inprogress },
  { label: 'Not started', color: SCOL.notstarted },
  { label: 'Completed', color: SCOL.completed },
];

export function MyWorkView({ projects, loginUser, departments, dispatch, toast, onOpenProject }) {
  const defaultPerson = loginUser?.ready ? loginUser.name || '' : '';
  const [person, setPerson] = useState('');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [scopeAssigned, setScopeAssigned] = useState(true);
  const [scopeComments, setScopeComments] = useState(false);
  const [scopeDepartment, setScopeDepartment] = useState(false);
  const [projectFilter, setProjectFilter] = useState([]);
  const [statusFilters, setStatusFilters] = useState([]);
  const [view, setView] = useState('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState(todayYmd());
  const [activeItem, setActiveItem] = useState(null);

  useEffect(() => {
    if (loginUser?.ready && loginUser.name) setPerson(loginUser.name);
  }, [loginUser?.ready, loginUser?.name]);

  const roster = useMemo(() => buildAssigneeRoster(projects, departments, loginUser), [projects, departments, loginUser]);
  const effectivePerson = person || defaultPerson;

  const { items, todayStr } = useMemo(
    () =>
      buildMyWorkItems(projects, {
        person: effectivePerson,
        departments,
        scopes: {
          assigned: scopeAssigned,
          myComments: scopeComments,
          myDepartment: scopeDepartment,
        },
        projectIds: projectFilter,
        statusFilters,
      }),
    [
      projects,
      effectivePerson,
      departments,
      scopeAssigned,
      scopeComments,
      scopeDepartment,
      projectFilter,
      statusFilters,
    ],
  );

  const filtered = useMemo(
    () => (hideCompleted ? items.filter((i) => i.st !== 'completed') : items),
    [items, hideCompleted],
  );
  const summary = useMemo(() => myWorkSummary(items, todayStr), [items, todayStr]);

  const allProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const toggleProject = (id) => {
    setProjectFilter((prev) => {
      if (prev.length === 0) return allProjectIds.filter((x) => x !== id);
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id];
      return next.length >= allProjectIds.length ? [] : next;
    });
  };

  const myDepts = useMemo(() => (departments || []).filter((d) => assigneeMatches(d.head, effectivePerson)), [departments, effectivePerson]);

  const selectedDayItems = useMemo(
    () => filtered.filter((i) => itemMatchesCalendarDay(i, selectedYmd)),
    [filtered, selectedYmd],
  );

  return (
    <div className="mywork">
      <header className="mw-hero mw-cal-hero">
        <div className="mw-hero-inner">
          <p className="mw-eyebrow">Personal workboard</p>
          <h1 className="mw-title disp">My Work</h1>
          <p className="mw-sub">
            Calendar view by next-action date and activity due date. Click a task to edit comments.
          </p>
        </div>
        <div className="mw-stats">
          <div className="mw-stat mw-stat-risk"><span className="mw-stat-n disp">{summary.overdue}</span><span className="mw-stat-l">Overdue</span></div>
          <div className="mw-stat mw-stat-today"><span className="mw-stat-n disp">{summary.today}</span><span className="mw-stat-l">Due today</span></div>
          <div className="mw-stat"><span className="mw-stat-n disp">{summary.week}</span><span className="mw-stat-l">This week</span></div>
          <div className="mw-stat"><span className="mw-stat-n disp">{summary.total}</span><span className="mw-stat-l">Open</span></div>
        </div>
      </header>

      <div className="mw-toolbar card mw-cal-filters">
        <div className="mw-filter-grid">
          <div className="mw-toolbar-field">
            <label htmlFor="mw-person">Person</label>
            <select id="mw-person" className="mw-select" value={effectivePerson} onChange={(e) => setPerson(e.target.value)}>
              {!roster.includes(defaultPerson) && defaultPerson ? <option value={defaultPerson}>{defaultPerson} (you)</option> : null}
              {roster.map((a) => (
                <option key={a} value={a}>{a}{assigneeMatches(a, defaultPerson) ? ' (you)' : ''}</option>
              ))}
            </select>
          </div>
          <div className="mw-toolbar-field mw-toolbar-status">
            <label>Status</label>
            <StatusFilterChips value={statusFilters} onChange={setStatusFilters} />
          </div>
        </div>
        <fieldset className="mw-scope">
          <legend>Show work</legend>
          <label className="mw-check"><input type="checkbox" checked={scopeAssigned} onChange={(e) => setScopeAssigned(e.target.checked)} />Assigned to me</label>
          <label className="mw-check"><input type="checkbox" checked={scopeComments} onChange={(e) => setScopeComments(e.target.checked)} />My comments</label>
          <label className="mw-check"><input type="checkbox" checked={scopeDepartment} onChange={(e) => setScopeDepartment(e.target.checked)} />My department</label>
        </fieldset>
        {projects.length > 1 ? (
          <details className="mw-projects-compact">
            <summary>
              Projects {projectFilter.length ? `(${projectFilter.length} selected)` : '(all)'}
            </summary>
            <div className="mw-proj-toolbar">
              <button type="button" className="mw-proj-mini-btn" onClick={() => setProjectFilter([])}>All</button>
              <button type="button" className="mw-proj-mini-btn" onClick={() => setProjectFilter(allProjectIds)}>None</button>
            </div>
            <div className="mw-proj-chips">
              {projects.map((p) => (
                <label key={p.id} className={`mw-proj-chip${projectFilter.length === 0 || projectFilter.includes(p.id) ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={projectFilter.length === 0 || projectFilter.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </details>
        ) : null}
        <label className="mw-check"><input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />Hide completed</label>
      </div>

      {!effectivePerson ? (
        <div className="mw-empty card"><p>Sign in via the platform vault to load your name, or pick a person above.</p></div>
      ) : !scopeAssigned && !scopeComments && !scopeDepartment ? (
        <div className="mw-empty card"><p>Select at least one filter under &quot;Show work&quot;.</p></div>
      ) : (
        <>
          <div className="mw-cal-shell">
          <ActivityCalendarShell
            eyebrow="My Work"
            view={view}
            cursorDate={cursorDate}
            selectedYmd={selectedYmd}
            tasks={filtered}
            getTaskYmd={(item) => getItemCalendarDates(item)}
            getTaskId={(item) => `${item.proj.id}-${item.task.id}`}
            getTaskTitle={(item) => `${item.task.name} · ${item.proj.name}`}
            getTaskColor={(item) => SCOL[item.st] || '#1A304A'}
            onViewChange={setView}
            onCursorChange={setCursorDate}
            onToday={() => {
              const t = new Date();
              setCursorDate(t);
              setSelectedYmd(todayYmd());
            }}
            onSelectDay={(ymd) => {
              setSelectedYmd(ymd);
              const d = parseYmd(ymd);
              if (d) setCursorDate(d);
            }}
            onTaskClick={setActiveItem}
            legend={LEGEND}
          />
          </div>

          {selectedYmd && view !== 'day' ? (
            <section className="card mw-cal-day-panel">
              <h3 className="disp" style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>
                {formatShortDate(selectedYmd)} · {selectedDayItems.length} task{selectedDayItems.length !== 1 ? 's' : ''}
              </h3>
              {selectedDayItems.length === 0 ? (
                <p className="mw-sub" style={{ margin: 0 }}>No tasks on this date. Pick another day or adjust filters.</p>
              ) : (
                <ul className="mw-cal-day-list">
                  {selectedDayItems.map((item) => (
                    <li key={`${item.proj.id}-${item.task.id}`}>
                      <button type="button" className="mw-cal-day-list-btn" onClick={() => setActiveItem(item)}>
                        <span className={`badge ${statusBadgeClass(item.st)}`}>{statusLabel(item.st)}</span>
                        <strong>{item.task.name}</strong>
                        <span className="mw-sub">{item.proj.name} · {calendarDateLabel(item, selectedYmd)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </>
      )}

      {activeItem ? (
        <div className="mw-cal-drawer-backdrop" onClick={() => setActiveItem(null)} role="presentation">
          <aside className="mw-cal-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mw-cal-drawer-head">
              <div>
                <div className="mw-cal-drawer-kicker">{activeItem.proj.name} · {activeItem.ph.name}</div>
                <h3>{activeItem.task.name}</h3>
              </div>
              <button type="button" className="btg" onClick={() => setActiveItem(null)}>Close</button>
            </div>
            <span className={`badge ${statusBadgeClass(activeItem.st)}`}>{statusLabel(activeItem.st)}</span>
            <p className="mw-sub" style={{ margin: 0 }}>
              Next / due: {formatShortDate(activeItem.sortDate)}
              {activeItem.nextAction?.nextAction ? ` · ${activeItem.nextAction.nextAction}` : ''}
            </p>
            <TaskCommentPanel
              proj={activeItem.proj}
              ph={activeItem.ph}
              task={activeItem.task}
              dispatch={dispatch}
              toast={toast}
              authorName={effectivePerson || 'User'}
              authorEmail={loginUser?.email}
              departments={departments}
            />
            <button type="button" className="btg mw-open-task" onClick={() => onOpenProject(activeItem.proj.id)}>
              Open task in project
            </button>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
