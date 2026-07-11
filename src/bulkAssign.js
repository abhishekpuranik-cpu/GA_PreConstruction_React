import { getDepartmentForPhase, normalizeDepartments, parseRolesInput } from './preconDepartments.js';

function collectAssigneesFromWho(who, set) {
  String(who || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((name) => set.add(name));
}

function finalizeRow(row, sortKey) {
  return {
    ...row,
    assignees: [...row.assignees].sort((a, b) => a.localeCompare(b)),
  };
}

export function taskHasRole(task, role) {
  const needle = String(role || '').trim().toLowerCase();
  if (!needle) return false;
  const roles = Array.isArray(task.roles) ? task.roles : parseRolesInput(task.roles);
  return roles.some((r) => String(r).trim().toLowerCase() === needle);
}

export function taskInDepartment(ph, deptId, departments) {
  if (!deptId) return false;
  const dept = getDepartmentForPhase(ph?.name, departments);
  return dept?.id === deptId;
}

/** Group project tasks by lifecycle role for bulk allocation. */
export function buildRoleAllocateRows(proj) {
  const map = new Map();
  (proj?.phases || []).forEach((ph) => {
    (ph.tasks || []).forEach((task) => {
      const roles = Array.isArray(task.roles) ? task.roles : parseRolesInput(task.roles);
      roles.forEach((role) => {
        const key = String(role || '').trim();
        if (!key) return;
        if (!map.has(key)) {
          map.set(key, { key, label: key, head: '', tasks: [], unassigned: 0, assignees: new Set() });
        }
        const row = map.get(key);
        row.tasks.push({ ph, task });
        if (!String(task.who || '').trim()) row.unassigned += 1;
        else collectAssigneesFromWho(task.who, row.assignees);
      });
    });
  });
  return [...map.values()]
    .map((row) => finalizeRow(row))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Group project tasks by department (phase mapping). */
export function buildDepartmentAllocateRows(proj, departments) {
  const depts = normalizeDepartments(departments);
  const map = new Map();
  depts.forEach((d) => {
    map.set(d.id, {
      key: d.id,
      label: d.name,
      head: d.head || '',
      tasks: [],
      unassigned: 0,
      assignees: new Set(),
    });
  });

  (proj?.phases || []).forEach((ph) => {
    const dept = getDepartmentForPhase(ph.name, depts);
    if (!dept) return;
    const row = map.get(dept.id);
    if (!row) return;
    (ph.tasks || []).forEach((task) => {
      row.tasks.push({ ph, task });
      if (!String(task.who || '').trim()) row.unassigned += 1;
      else collectAssigneesFromWho(task.who, row.assignees);
    });
  });

  return [...map.values()]
    .filter((row) => row.tasks.length > 0)
    .map((row) => finalizeRow(row))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Rows for department-head quick assign (departments that have tasks). */
export function buildDeptHeadAllocateRows(proj, departments) {
  return buildDepartmentAllocateRows(proj, departments).map((row) => ({
    ...row,
    canAssignHead: !!String(row.head || '').trim(),
  }));
}
