import React, { useMemo, useState } from 'react';
import { AssigneeMultiSelect } from './AssigneeMultiSelect.jsx';
import {
  buildDeptHeadAllocateRows,
  buildDepartmentAllocateRows,
  buildRoleAllocateRows,
} from './bulkAssign.js';
import { formatAssignees } from './preconAssignees.js';

function sumTotals(rows) {
  let tasks = 0;
  let unassigned = 0;
  rows.forEach((r) => {
    tasks += r.tasks.length;
    unassigned += r.unassigned;
  });
  return { groups: rows.length, tasks, unassigned };
}

function AllocTable({
  columnLabel,
  rows,
  drafts,
  setDraft,
  expandedKey,
  setExpandedKey,
  onlyUnassigned,
  assigneeRoster,
  onApply,
  getDefaultDraft,
  showHeadColumn = false,
}) {
  if (!rows.length) return null;

  return (
    <div className="alloc-table-wrap">
      <table className="alloc-table">
        <thead>
          <tr>
            <th>{columnLabel}</th>
            {showHeadColumn ? <th>Dept head</th> : null}
            <th>Tasks</th>
            <th>Unassigned</th>
            <th>Current assignees</th>
            <th>Assign to</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.key] ?? getDefaultDraft?.(row) ?? '';
            const isOpen = expandedKey === row.key;
            return (
              <React.Fragment key={row.key}>
                <tr className="alloc-row">
                  <td className="alloc-role">
                    <button
                      type="button"
                      className="alloc-expand"
                      onClick={() => setExpandedKey(isOpen ? '' : row.key)}
                      aria-expanded={isOpen}
                      title="Show tasks"
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                    <span>{row.label}</span>
                  </td>
                  {showHeadColumn ? (
                    <td className="alloc-head-cell">
                      {row.head ? row.head : <span className="alloc-muted">Not set</span>}
                    </td>
                  ) : null}
                  <td>{row.tasks.length}</td>
                  <td>{row.unassigned ? <span className="alloc-warn">{row.unassigned}</span> : '0'}</td>
                  <td className="alloc-current">
                    {row.assignees.length ? row.assignees.join('; ') : <span className="alloc-muted">—</span>}
                  </td>
                  <td className="alloc-picker">
                    <AssigneeMultiSelect
                      compact
                      value={draft}
                      options={assigneeRoster}
                      onChange={(v) => setDraft(row.key, v)}
                    />
                  </td>
                  <td className="alloc-actions">
                    <button type="button" className="btp alloc-apply" onClick={() => onApply(row, draft, false)}>
                      Apply
                    </button>
                    {!onlyUnassigned && row.assignees.length ? (
                      <button
                        type="button"
                        className="bts alloc-overwrite"
                        onClick={() => onApply(row, draft, true)}
                        title="Replace assignee on all matching tasks"
                      >
                        Replace all
                      </button>
                    ) : null}
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="alloc-detail-row">
                    <td colSpan={showHeadColumn ? 7 : 6}>
                      <ul className="alloc-task-list">
                        {row.tasks.map(({ ph, task }) => (
                          <li key={`${row.key}-${task.id}`}>
                            <span className="alloc-task-phase">{ph.name}</span>
                            <span className="alloc-task-name">{task.name}</span>
                            <span className="alloc-task-who">{task.who || 'Unassigned'}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Project sub-tab: bulk assign tasks by role, department, or department head.
 */
export function BulkAllocateView({ proj, dispatch, assigneeRoster, departments, toast, onEditDepartments }) {
  const [mode, setMode] = useState('role');
  const [drafts, setDrafts] = useState({});
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [expandedKey, setExpandedKey] = useState('');

  const roleRows = useMemo(() => buildRoleAllocateRows(proj), [proj]);
  const deptRows = useMemo(() => buildDepartmentAllocateRows(proj, departments), [proj, departments]);
  const headRows = useMemo(() => buildDeptHeadAllocateRows(proj, departments), [proj, departments]);

  const rows = mode === 'role' ? roleRows : mode === 'department' ? deptRows : headRows;
  const totals = useMemo(() => sumTotals(rows), [rows]);

  const setDraft = (key, who) => setDrafts((prev) => ({ ...prev, [key]: who }));

  const dispatchAssign = (actionType, payload, successMsg) => {
    dispatch({ ...payload, type: actionType, projId: proj.id });
    toast?.(successMsg, 'ok');
  };

  const applyRole = (row, who, overwrite) => {
    const assignee = String(who || '').trim();
    if (!assignee) {
      toast?.('Select at least one assignee', 'err');
      return;
    }
    dispatchAssign(
      'bulkAssignByRole',
      { role: row.label, who: assignee, onlyUnassigned: onlyUnassigned && !overwrite, overwrite },
      `Assigned ${row.label} tasks to ${assignee}`,
    );
  };

  const applyDepartment = (row, who, overwrite) => {
    const assignee = String(who || '').trim();
    if (!assignee) {
      toast?.('Select at least one assignee', 'err');
      return;
    }
    dispatchAssign(
      'bulkAssignByDepartment',
      { deptId: row.key, who: assignee, onlyUnassigned: onlyUnassigned && !overwrite, overwrite },
      `Assigned ${row.label} tasks to ${assignee}`,
    );
  };

  const applyDeptHead = (row, overwrite) => {
    const head = String(row.head || '').trim();
    if (!head) {
      toast?.(`Set a department head for ${row.label} first`, 'err');
      onEditDepartments?.();
      return;
    }
    dispatchAssign(
      'bulkAssignByDepartment',
      { deptId: row.key, who: head, onlyUnassigned: onlyUnassigned && !overwrite, overwrite, useDeptHead: true },
      `Assigned ${row.label} tasks to head ${head}`,
    );
  };

  const applyAll = () => {
    let applied = 0;
    if (mode === 'role') {
      roleRows.forEach((row) => {
        const who = drafts[row.key] ?? (row.assignees.length === 1 ? formatAssignees(row.assignees) : '');
        if (!String(who).trim()) return;
        dispatch({
          type: 'bulkAssignByRole',
          projId: proj.id,
          role: row.label,
          who,
          onlyUnassigned,
          overwrite: false,
        });
        applied += 1;
      });
    } else if (mode === 'department') {
      deptRows.forEach((row) => {
        const who = drafts[row.key] ?? row.head ?? (row.assignees.length === 1 ? formatAssignees(row.assignees) : '');
        if (!String(who).trim()) return;
        dispatch({
          type: 'bulkAssignByDepartment',
          projId: proj.id,
          deptId: row.key,
          who,
          onlyUnassigned,
          overwrite: false,
        });
        applied += 1;
      });
    } else {
      headRows.forEach((row) => {
        if (!row.canAssignHead) return;
        dispatch({
          type: 'bulkAssignByDepartment',
          projId: proj.id,
          deptId: row.key,
          who: row.head,
          onlyUnassigned,
          overwrite: false,
          useDeptHead: true,
        });
        applied += 1;
      });
    }
    if (!applied) {
      toast?.(
        mode === 'head' ? 'Set department heads under Departments first' : 'Set assignees for at least one row first',
        'err',
      );
      return;
    }
    toast?.(
      mode === 'head'
        ? `Assigned tasks to ${applied} department head${applied !== 1 ? 's' : ''}`
        : `Applied assignees for ${applied} row${applied !== 1 ? 's' : ''}`,
      'ok',
    );
  };

  const hints = {
    role: 'Pick an assignee for each process role and apply in one click. Tasks with multiple roles appear under each matching role.',
    department: 'Assign all tasks in each department (by phase). Default suggestion is the department head — change if needed.',
    head: 'One-click assign every task in a department to its configured head. Set heads via Departments in the top nav.',
  };

  const emptyMessages = {
    role: {
      title: 'No lifecycle roles on this project',
      body: 'Tasks from the CEME template include role placeholders (e.g. Architect, Acq Lead).',
    },
    department: {
      title: 'No tasks mapped to departments',
      body: 'Phases are mapped to Design, Acquisition, or Execution departments automatically.',
    },
    head: {
      title: 'No department tasks found',
      body: 'Add phases and tasks, then configure department heads from the Departments button in the nav.',
    },
  };

  if (!rows.length) {
    const msg = emptyMessages[mode];
    return (
      <div className="alloc-panel">
        <AllocModeTabs mode={mode} setMode={setMode} />
        <div className="alloc-empty">
          <h3>{msg.title}</h3>
          <p>{msg.body}</p>
          {mode !== 'role' && onEditDepartments ? (
            <button type="button" className="btp" style={{ marginTop: 14 }} onClick={onEditDepartments}>
              Edit department heads
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="alloc-panel">
      <AllocModeTabs mode={mode} setMode={setMode} />

      <header className="alloc-head">
        <div>
          <h3 className="alloc-title">
            {mode === 'role' ? 'By role' : mode === 'department' ? 'By department' : 'By department head'}
          </h3>
          <p className="alloc-meta">
            {totals.groups} group{totals.groups !== 1 ? 's' : ''} · {totals.tasks} tasks · {totals.unassigned} unassigned
          </p>
        </div>
        <label className="alloc-toggle">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          Only update unassigned tasks
        </label>
      </header>

      <p className="alloc-hint">{hints[mode]}</p>

      {mode === 'role' ? (
        <AllocTable
          columnLabel="Role"
          rows={roleRows}
          drafts={drafts}
          setDraft={setDraft}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          onlyUnassigned={onlyUnassigned}
          assigneeRoster={assigneeRoster}
          onApply={applyRole}
          getDefaultDraft={(row) => (row.assignees.length === 1 ? row.assignees[0] : '')}
        />
      ) : null}

      {mode === 'department' ? (
        <AllocTable
          columnLabel="Department"
          rows={deptRows}
          drafts={drafts}
          setDraft={setDraft}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          onlyUnassigned={onlyUnassigned}
          assigneeRoster={assigneeRoster}
          onApply={applyDepartment}
          showHeadColumn
          getDefaultDraft={(row) => row.head || (row.assignees.length === 1 ? row.assignees[0] : '')}
        />
      ) : null}

      {mode === 'head' ? (
        <div className="alloc-head-cards">
          {headRows.map((row) => (
            <article key={row.key} className="alloc-head-card">
              <div className="alloc-head-card-main">
                <h4>{row.label}</h4>
                <p className="alloc-head-card-meta">
                  {row.tasks.length} tasks · {row.unassigned} unassigned
                </p>
                <p className="alloc-head-card-person">
                  Head:{' '}
                  {row.head ? <strong>{row.head}</strong> : <span className="alloc-muted">Not configured</span>}
                </p>
              </div>
              <div className="alloc-head-card-actions">
                <button
                  type="button"
                  className="btp"
                  disabled={!row.canAssignHead}
                  onClick={() => applyDeptHead(row, false)}
                >
                  Assign to head
                </button>
                {!onlyUnassigned && row.assignees.length ? (
                  <button type="button" className="bts" onClick={() => applyDeptHead(row, true)}>
                    Replace all
                  </button>
                ) : null}
                <button type="button" className="bts" onClick={() => setExpandedKey(expandedKey === row.key ? '' : row.key)}>
                  {expandedKey === row.key ? 'Hide tasks' : 'Show tasks'}
                </button>
              </div>
              {expandedKey === row.key ? (
                <ul className="alloc-task-list alloc-task-list-card">
                  {row.tasks.map(({ ph, task }) => (
                    <li key={task.id}>
                      <span className="alloc-task-phase">{ph.name}</span>
                      <span className="alloc-task-name">{task.name}</span>
                      <span className="alloc-task-who">{task.who || 'Unassigned'}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      <footer className="alloc-foot">
        <button type="button" className="btg" onClick={applyAll}>
          {mode === 'head' ? 'Assign all departments to their heads' : `Apply all ${mode === 'role' ? 'roles' : 'departments'} with assignees set`}
        </button>
        {mode === 'head' && onEditDepartments ? (
          <button type="button" className="bts" onClick={onEditDepartments}>
            Edit department heads
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function AllocModeTabs({ mode, setMode }) {
  const tabs = [
    { id: 'role', label: 'By role' },
    { id: 'department', label: 'By department' },
    { id: 'head', label: 'By dept head' },
  ];
  return (
    <div className="alloc-modes" role="tablist" aria-label="Bulk allocate mode">
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={mode === id}
          className={`alloc-mode${mode === id ? ' act' : ''}`}
          onClick={() => setMode(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
