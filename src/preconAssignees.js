import { iterAllTasks } from './preconExport.js';
import { canonicalAssigneeName } from './preconAssigneeNames.js';

/** Split stored assignee text into individual names (supports ";", ",", "&", "and"). */
export function expandAssigneeTokens(who) {
  return String(who || '')
    .split(/\s*[;,]\s*|\s+&\s+|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Multi-assignee stored in task.who as "; "-separated names. */
export function parseAssignees(who) {
  return expandAssigneeTokens(who);
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
  const w = canonicalAssigneeName(a).toLowerCase();
  const p = canonicalAssigneeName(b).toLowerCase();
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
    expandAssigneeTokens(t.who).forEach((a) => set.add(a));
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Projects used for assignee dropdown (Admin-assigned + current project if open). */
export function projectsForAssigneeRoster(allProjects, loginUser, currentProject) {
  const visible = filterProjectsForUser(allProjects, loginUser);
  if (!currentProject?.id) return visible;
  if (visible.some((p) => p.id === currentProject.id)) return visible;
  return [...visible, currentProject];
}

const NON_ADOPTED = new Set(['pipeline', 'evaluation']);
const COMPLETED_LIKE = new Set(['under construction', 'completed', 'closed', 'cancelled']);

/** Aligns with platform Admin "Add all active" rules. */
export function isProjectAssignable(project) {
  const s = String(project?.status || '').trim().toLowerCase();
  if (!s) return true;
  if (NON_ADOPTED.has(s)) return false;
  if (COMPLETED_LIKE.has(s)) return false;
  if (s.includes('complete')) return false;
  if (s.includes('non-adopted') || s.includes('non adopted')) return false;
  return true;
}

/** True when project is in the user's Admin Security allowed list (exact or partial name/id). */
function projectInAllowedList(project, allowed) {
  if (!Array.isArray(allowed) || !allowed.length) return true;
  const id = String(project?.id || '').toLowerCase();
  const name = String(project?.name || '').toLowerCase();
  return allowed.some((raw) => {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return false;
    if (key === id || key === name) return true;
    if (name.includes(key) || key.includes(name)) return true;
    if (id.includes(key) || key.includes(id)) return true;
    return nameMatches(name, key) || nameMatches(key, name);
  });
}

/** Projects visible per Admin Security allowedProjects (name or id); empty list = all. */
export function filterProjectsForUser(projects, loginUser) {
  const list = projects || [];
  if (!loginUser?.ready) return list;
  const allowed = loginUser?.allowedProjects;
  if (!Array.isArray(allowed) || !allowed.length) return list;
  const filtered = list.filter((p) => projectInAllowedList(p, allowed));
  const seen = new Set(filtered.map((p) => p.id));
  list.forEach((p) => {
    if (!p?.id || seen.has(p.id)) return;
    if (String(p.id).startsWith('prj_')) {
      filtered.push(p);
      seen.add(p.id);
    }
  });
  return filtered;
}

/** Dropdown options: task assignees on allowed projects, Admin team, dept heads, login user. */
export function buildAssigneeRoster(projects, departments, loginUser) {
  const set = new Set(collectAssignees(projects));
  (loginUser?.teamNames || []).forEach((n) => {
    const t = String(n || '').trim();
    if (t) set.add(t);
  });
  (departments || []).forEach((d) => {
    const h = String(d.head || '').trim();
    if (h) set.add(h);
  });
  if (loginUser?.name) set.add(loginUser.name.trim());
  return [...set].sort((a, b) => a.localeCompare(b));
}
