import { iterAllTasks } from './preconExport.js';

/** Multi-assignee stored in task.who as "; "-separated names. */
export function parseAssignees(who) {
  return String(who || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatAssignees(names) {
  return [...new Set((names || []).map((s) => String(s).trim()).filter(Boolean))].join('; ');
}

/** Match if person appears in assignee list (or legacy single string). */
export function assigneeMatches(taskWho, person) {
  const p = String(person || '').trim().toLowerCase();
  if (!p || p === 'user') return false;
  const list = parseAssignees(taskWho);
  if (!list.length) return false;
  return list.some((w) => nameMatches(w, p));
}

export function nameMatches(a, b) {
  const w = String(a || '').trim().toLowerCase();
  const p = String(b || '').trim().toLowerCase();
  if (!w || !p) return false;
  if (w === p) return true;
  const wParts = w.split(/\s+/);
  const pParts = p.split(/\s+/);
  if (wParts.some((x) => x && p.includes(x))) return true;
  if (pParts.some((x) => x.length > 2 && w.includes(x))) return true;
  return false;
}

export function collectAssignees(projects) {
  const set = new Set();
  iterAllTasks(projects || [], ({ t }) => {
    parseAssignees(t.who).forEach((a) => set.add(a));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Projects visible per Admin Security allowedProjects (name or id); empty list = all. */
export function filterProjectsForUser(projects, loginUser) {
  const allowed = loginUser?.allowedProjects;
  if (!Array.isArray(allowed) || !allowed.length) return projects || [];
  const keys = new Set(allowed.map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  return (projects || []).filter((p) => {
    const id = String(p.id || '').toLowerCase();
    const name = String(p.name || '').toLowerCase();
    return keys.has(id) || keys.has(name);
  });
}

/** Dropdown options: assignees on allowed projects + department heads. */
export function buildAssigneeRoster(projects, departments, loginUser) {
  const set = new Set(collectAssignees(projects));
  (departments || []).forEach((d) => {
    const h = String(d.head || '').trim();
    if (h) set.add(h);
  });
  if (loginUser?.name) set.add(loginUser.name.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}
