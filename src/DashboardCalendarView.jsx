import React, { useMemo, useState } from 'react';
import { collectAssignees } from './preconExport.js';
import { TaskCommentPanel } from './TaskCommentPanel.jsx';
import { StatusFilterChips } from './StatusFilterChips.jsx';
import { statusLabel, statusBadgeClass } from './preconTaskStatus.js';
import { ActivityCalendarShell } from './ActivityCalendarShell.jsx';
import { parseYmd, todayYmd } from './activityCalendarUtils.js';
import {
  buildPortfolioWorkItems,
  calendarDateLabel,
  filterItemsByDepartment,
  formatShortDate,
  getItemCalendarDates,
  itemMatchesCalendarDay,
  myWorkSummary,
  summarizeDepartments,
} from './preconMyWork.js';
import { MyWorkLevelFilters } from './MyWorkLevelFilters.jsx';
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

export function DashboardCalendarView({
  projects,
  departments,
  dispatch,
  toast,
  loginUser,
  onOpenProject,
}) {
  const [hideCompleted, setHideCompleted] = useState(true);
  const [statusFilters, setStatusFilters] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [viewLevel, setViewLevel] = useState('overall');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [view, setView] = useState('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [selectedYmd, setSelectedYmd] = useState(todayYmd());
  const [activeItem, setActiveItem] = useState(null);

  const assignees = useMemo(() => collectAssignees(projects), [projects]);
  const authorName = loginUser?.ready ? loginUser.name || 'User' : 'User';

  const { items, todayStr } = useMemo(
    () =>
      buildPortfolioWorkItems(projects, {
        departments,
        statusFilters,
        assigneeFilter,
      }),
    [projects, departments, statusFilters, assigneeFilter],
  );

  const filtered = useMemo(
    () => (hideCompleted ? items.filter((i) => i.st !== 'completed') : items),
    [items, hideCompleted],
  );

  const deptSummaries = useMemo(
    () => summarizeDepartments(filtered, todayStr),
    [filtered, todayStr],
  );

  const levelFiltered = useMemo(() => {
    if (!departmentFilter) return filtered;
    return filterItemsByDepartment(filtered, departmentFilter);
  }, [filtered, departmentFilter]);

  const summary = useMemo(() => myWorkSummary(levelFiltered, todayStr), [levelFiltered, todayStr]);

  const handleViewLevelChange = (level) => {
    setViewLevel(level);
    if (level === 'department') {
      setDepartmentFilter((prev) => {
        if (prev) return prev;
        const busiest = deptSummaries.find((s) => s.open > 0);
        return busiest?.id || departments[0]?.id || '';
      });
    } else {
      setDepartmentFilter('');
    }
  };

  const selectedDayItems = useMemo(
    () => levelFiltered.filter((i) => itemMatchesCalendarDay(i, selectedYmd)),
    [levelFiltered, selectedYmd],
  );

  const taskTitle = (item) => {
    const who = item.task.who ? ` · ${item.task.who}` : '';
    const base = `${item.task.name} · ${item.proj.name}${who}`;
    if (viewLevel === 'overall' && !departmentFilter && item.dept?.name) {
      const short = item.dept.name.split(/[&/]/)[0].trim();
      return `${base} · ${short}`;
    }
    return base;
  };

  return (
    <div className="dash-cal">
      <header className="mw-hero mw-cal-hero">
        <div className="mw-hero-inner">
          <p className="mw-eyebrow">Portfolio workboard</p>
          <h2 className="mw-title disp">Work Calendar</h2>
          <p className="mw-sub">
            All assignees across {projects.length} project{projects.length !== 1 ? 's' : ''}. Filter by department to see every task in that team.
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
            <label htmlFor="dash-cal-assignee">Assignee</label>
            <select
              id="dash-cal-assignee"
              className="mw-select"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
            >
              <option value="">All assignees</option>
              {assignees.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="mw-toolbar-field mw-toolbar-status">
            <label>Status</label>
            <StatusFilterChips value={statusFilters} onChange={setStatusFilters} />
          </div>
        </div>
        <label className="mw-check">
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed
        </label>
        <MyWorkLevelFilters
          viewLevel={viewLevel}
          onViewLevelChange={handleViewLevelChange}
          departmentFilter={departmentFilter}
          onDepartmentFilterChange={setDepartmentFilter}
          departments={departments}
          deptSummaries={deptSummaries}
          overallHint="All departments — every assignee on one calendar"
          departmentHint="One department — all tasks assigned to anyone in that team"
        />
      </div>

      <div className="mw-cal-shell">
        <ActivityCalendarShell
          eyebrow="Portfolio"
          view={view}
          cursorDate={cursorDate}
          selectedYmd={selectedYmd}
          tasks={levelFiltered}
          getTaskYmd={(item) => getItemCalendarDates(item)}
          getTaskId={(item) => `${item.proj.id}-${item.task.id}`}
          getTaskTitle={taskTitle}
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
            <p className="mw-sub" style={{ margin: 0, color: '#55504A' }}>No tasks on this date. Pick another day or adjust filters.</p>
          ) : (
            <ul className="mw-cal-day-list">
              {selectedDayItems.map((item) => (
                <li key={`${item.proj.id}-${item.task.id}`}>
                  <button type="button" className="mw-cal-day-list-btn" onClick={() => setActiveItem(item)}>
                    <span className={`badge ${statusBadgeClass(item.st)}`}>{statusLabel(item.st)}</span>
                    <strong>{item.task.name}</strong>
                    <span className="mw-sub" style={{ color: '#55504A' }}>
                      {item.proj.name}
                      {item.dept?.name ? ` · ${item.dept.name}` : ''}
                      {item.task.who ? ` · ${item.task.who}` : ''}
                      {' · '}
                      {calendarDateLabel(item, selectedYmd)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

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
            <p className="mw-sub" style={{ margin: 0, color: '#55504A' }}>
              {activeItem.task.who ? `Assignee: ${activeItem.task.who} · ` : ''}
              Next / due: {formatShortDate(activeItem.sortDate)}
              {activeItem.nextAction?.nextAction ? ` · ${activeItem.nextAction.nextAction}` : ''}
            </p>
            <TaskCommentPanel
              proj={activeItem.proj}
              ph={activeItem.ph}
              task={activeItem.task}
              dispatch={dispatch}
              toast={toast}
              authorName={authorName}
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
