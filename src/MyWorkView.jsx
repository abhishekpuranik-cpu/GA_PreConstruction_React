import React, { useEffect, useMemo, useState } from 'react';
import { assigneeMatches, buildAssigneeRoster } from './preconAssignees.js';
import { validateCommentPayload } from './preconComments.js';
import { statusLabel, statusBadgeClass, TASK_STATUS_OPTIONS } from './preconTaskStatus.js';
import {
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

function now() {
  return new Date().toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function WorkListRow({ item, person, dispatch, toast, onOpenProject, defaultExpanded }) {
  const { proj, ph, task, st, sortDate, sortSource, nextDate, dueDate, nextAction, overdueDays, dept, editable } =
    item;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [text, setText] = useState('');
  const [nextAct, setNextAct] = useState('');
  const [nextDateVal, setNextDateVal] = useState('');

  useEffect(() => {
    const c = editable?.comment;
    setText(c?.text || '');
    setNextAct(c?.nextAction || '');
    setNextDateVal(c?.nextActionDate || '');
  }, [editable?.comment, task.id, editable?.commentIndex]);

  const saveComment = () => {
    const err = validateCommentPayload({ text, nextAction: nextAct, nextActionDate: nextDateVal });
    if (err) {
      toast(err, 'err');
      return;
    }
    const author = person || 'User';
    const patch = {
      text: text.trim(),
      nextAction: nextAct.trim(),
      nextActionDate: nextDateVal.trim(),
      ts: now(),
      flag: /issue|block|delay|risk/i.test(text),
    };
    if (editable) {
      patch.author = editable.comment?.author || author;
      dispatch({
        type: 'updComment',
        projId: proj.id,
        phId: ph.id,
        tId: task.id,
        commentIndex: editable.commentIndex,
        patch,
      });
    } else {
      patch.author = author;
      dispatch({
        type: 'addComment',
        projId: proj.id,
        phId: ph.id,
        tId: task.id,
        comment: patch,
      });
    }
    toast('Saved — updates appear on the project task', 'ok');
  };

  const chronologyLabel =
    sortSource === 'next_action'
      ? 'Next'
      : sortSource === 'planned_end'
        ? 'Due'
        : sortSource === 'both'
          ? 'Next & due'
          : 'Date';

  const showNextDate =
    nextDate && (!sortDate || formatShortDate(nextDate) !== formatShortDate(sortDate));
  const showDueDate =
    dueDate && (!sortDate || formatShortDate(dueDate) !== formatShortDate(sortDate));

  return (
    <li className="mw-row" style={{ '--mw-accent': SCOL[st] || '#1A304A' }}>
      <div className="mw-row-top">
        <div className="mw-row-date" title={chronologyLabel}>
          <span className="mw-row-date-val">{formatShortDate(sortDate)}</span>
          <span className="mw-row-date-lbl">{chronologyLabel}</span>
          {overdueDays > 0 ? <span className="mw-row-late">+{overdueDays}d</span> : null}
        </div>
        <div className="mw-row-body">
          <div className="mw-row-line1">
            <button type="button" className="mw-proj-link" onClick={() => onOpenProject(proj.id)}>
              {proj.name}
            </button>
            <span className={`badge mw-row-badge ${statusBadgeClass(st)}`}>{statusLabel(st)}</span>
            <span className="mw-task-name" title={task.name}>
              {task.name}
            </span>
          </div>
          <div className="mw-row-line2">
            <span className="mw-phase" style={{ borderColor: ph.col, color: ph.col }}>
              {ph.name}
            </span>
            {dept ? <span className="mw-dept-tag">{dept.name}</span> : null}
            {proj.loc ? <span className="mw-loc">{proj.loc}</span> : null}
            {showNextDate ? (
              <span className="mw-row-extra">
                Next {formatShortDate(nextDate)}
              </span>
            ) : null}
            {showDueDate ? (
              <span className="mw-row-extra">
                Due {formatShortDate(dueDate)}
              </span>
            ) : null}
          </div>
          {nextAction?.nextAction || nextAction?.commentSnippet ? (
            <p className="mw-row-preview" title={[nextAction?.nextAction, nextAction?.commentSnippet].filter(Boolean).join(' — ')}>
              {nextAction?.nextAction ? (
                <span>
                  <strong>Next:</strong> {nextAction.nextAction}
                </span>
              ) : null}
              {nextAction?.commentSnippet ? (
                <span className="mw-row-preview-cmt">{nextAction.commentSnippet}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="mw-expand-btn"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
        >
          {expanded ? 'Hide' : 'Edit'}
        </button>
      </div>
      {expanded ? (
          <div className="mw-editor">
            <label className="mw-ed-lbl">
              Comment *
              <textarea
                className="cform-textarea"
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Progress, issue, or decision…"
              />
            </label>
            <label className="mw-ed-lbl">
              Next action *
              <input
                type="text"
                className="cform-inp"
                value={nextAct}
                onChange={(e) => setNextAct(e.target.value)}
                placeholder="What happens next?"
              />
            </label>
            <label className="mw-ed-lbl">
              Next action date *
              <input
                type="date"
                className="cform-inp cform-inp-date"
                value={nextDateVal}
                onChange={(e) => setNextDateVal(e.target.value)}
              />
            </label>
            <div className="mw-ed-actions">
              <button type="button" className="btp" onClick={saveComment}>
                Save
              </button>
              <button type="button" className="btg" onClick={() => onOpenProject(proj.id)}>
                Open task in project
              </button>
            </div>
          </div>
        ) : null}
    </li>
  );
}

export function MyWorkView({ projects, loginUser, departments, dispatch, toast, onOpenProject }) {
  const defaultPerson = loginUser?.ready ? loginUser.name || '' : '';
  const [person, setPerson] = useState('');
  const [hideCompleted, setHideCompleted] = useState(true);
  const [scopeAssigned, setScopeAssigned] = useState(true);
  const [scopeComments, setScopeComments] = useState(false);
  const [scopeDepartment, setScopeDepartment] = useState(false);
  const [projectFilter, setProjectFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');

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
        statusFilter,
      }),
    [
      projects,
      effectivePerson,
      departments,
      scopeAssigned,
      scopeComments,
      scopeDepartment,
      projectFilter,
      statusFilter,
    ]
  );

  const filtered = useMemo(
    () => (hideCompleted ? items.filter((i) => i.st !== 'completed') : items),
    [items, hideCompleted]
  );
  const groups = useMemo(() => groupMyWorkItems(filtered, todayStr), [filtered, todayStr]);
  const summary = useMemo(() => myWorkSummary(items, todayStr), [items, todayStr]);
  const displayGroups = hideCompleted ? groups.filter((g) => g.id !== 'done') : groups;

  const allProjectIds = useMemo(() => projects.map((p) => p.id), [projects]);
  const toggleProject = (id) => {
    setProjectFilter((prev) => {
      if (prev.length === 0) return allProjectIds.filter((x) => x !== id);
      if (prev.includes(id)) {
        const next = prev.filter((x) => x !== id);
        return next;
      }
      const next = [...prev, id];
      return next.length >= allProjectIds.length ? [] : next;
    });
  };

  const myDepts = useMemo(() => {
    return (departments || []).filter((d) => assigneeMatches(d.head, effectivePerson));
  }, [departments, effectivePerson]);

  return (
    <div className="mywork">
      <header className="mw-hero">
        <div className="mw-hero-inner">
          <p className="mw-eyebrow">Personal workboard</p>
          <h1 className="mw-title disp">My Work</h1>
          <p className="mw-sub">
            Chronological list sorted by the <strong>earlier</strong> of next-action date and task due date.
            Edit comments here — changes sync to the project task.
          </p>
          {loginUser?.ready ? (
            <p className="mw-signed">
              Signed in as <strong>{loginUser.name}</strong>
              {loginUser.email ? ` · ${loginUser.email}` : ''}
              {loginUser.allowedProjects?.length ? (
                <span>
                  {' '}
                  · {loginUser.allowedProjects.length} assigned project
                  {loginUser.allowedProjects.length !== 1 ? 's' : ''}
                </span>
              ) : null}
            </p>
          ) : null}
          {myDepts.length ? (
            <p className="mw-signed">
              Your department{myDepts.length > 1 ? 's' : ''}: {myDepts.map((d) => d.name).join(', ')}
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
            <span className="mw-stat-l">Open</span>
          </div>
        </div>
      </header>

      <div className="mw-toolbar card">
        <div className="mw-filter-grid">
          <div className="mw-toolbar-field">
            <label htmlFor="mw-person">Person</label>
            <select
              id="mw-person"
              className="mw-select"
              value={effectivePerson}
              onChange={(e) => setPerson(e.target.value)}
            >
              {!roster.includes(defaultPerson) && defaultPerson ? (
                <option value={defaultPerson}>{defaultPerson} (you)</option>
              ) : null}
              {roster.map((a) => (
                <option key={a} value={a}>
                  {a}
                  {assigneeMatches(a, defaultPerson) ? ' (you)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="mw-toolbar-field">
            <label htmlFor="mw-status">Status</label>
            <select
              id="mw-status"
              className="mw-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {TASK_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </div>
        <fieldset className="mw-scope">
          <legend>Show work</legend>
          <label className="mw-check">
            <input type="checkbox" checked={scopeAssigned} onChange={(e) => setScopeAssigned(e.target.checked)} />
            Assigned to me
          </label>
          <label className="mw-check">
            <input type="checkbox" checked={scopeComments} onChange={(e) => setScopeComments(e.target.checked)} />
            My comments
          </label>
          <label className="mw-check">
            <input
              type="checkbox"
              checked={scopeDepartment}
              onChange={(e) => setScopeDepartment(e.target.checked)}
            />
            My department
          </label>
        </fieldset>
        {projects.length > 1 ? (
          <fieldset className="mw-scope mw-projects">
            <legend>Projects {projectFilter.length ? `(${projectFilter.length} selected)` : '(all)'}</legend>
            <div className="mw-proj-chips">
              {projects.map((p) => (
                <label key={p.id} className={`mw-proj-chip${projectFilter.includes(p.id) ? ' on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={projectFilter.length === 0 || projectFilter.includes(p.id)}
                    onChange={() => toggleProject(p.id)}
                  />
                  {p.name}
                </label>
              ))}
              {projectFilter.length ? (
                <button type="button" className="ams-clear" onClick={() => setProjectFilter([])}>
                  All projects
                </button>
              ) : null}
            </div>
          </fieldset>
        ) : null}
        <label className="mw-check">
          <input type="checkbox" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
          Hide completed
        </label>
      </div>

      {!effectivePerson ? (
        <div className="mw-empty card">
          <p>Sign in via the platform vault to load your name, or pick a person above.</p>
        </div>
      ) : !scopeAssigned && !scopeComments && !scopeDepartment ? (
        <div className="mw-empty card">
          <p>Select at least one filter under &quot;Show work&quot;.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="mw-empty card">
          <div className="mw-empty-icon" aria-hidden>
            ✓
          </div>
          <h2 className="disp">All clear</h2>
          <p>No items match your filters for <strong>{effectivePerson}</strong>.</p>
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
              <ul className="mw-list">
                {group.items.map((item) => (
                  <WorkListRow
                    key={`${item.proj.id}-${item.task.id}`}
                    item={item}
                    person={effectivePerson}
                    dispatch={dispatch}
                    toast={toast}
                    onOpenProject={onOpenProject}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
