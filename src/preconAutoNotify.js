import { parseAssignees, nameMatches } from './preconAssignees.js';
import { getDepartmentForPhase } from './preconDepartments.js';

const EXTRA_KEY = 'ga_precon_notify_extra';

export function mergeRecipients(...lists) {
  const byEmail = new Map();
  for (const list of lists) {
    for (const r of list || []) {
      const email = String(r?.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) continue;
      const name = String(r?.name || '').trim() || email;
      if (!byEmail.has(email)) byEmail.set(email, { name, email });
    }
  }
  return [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Client-side mirror of server auto list (for UI preview). */
export function computeAutoRecipients(groups, { departments, phaseName, taskWho }) {
  const withEmail = (list) => (list || []).filter((r) => r.email && !r.noEmail);
  const taskNames = parseAssignees(taskWho);
  const taskAssignees = withEmail(groups?.assignees).filter((a) =>
    taskNames.some((n) => nameMatches(a.name, n))
  );
  const phaseDept = getDepartmentForPhase(phaseName, departments);
  const phaseHeadName = String(phaseDept?.head || '').trim();
  const phaseHead = phaseHeadName
    ? withEmail(groups?.departmentHeads).find((h) => nameMatches(h.name, phaseHeadName))
    : null;

  return mergeRecipients(
    withEmail(groups?.departmentHeads),
    withEmail(groups?.leadership),
    taskAssignees,
    phaseHead ? [phaseHead] : []
  );
}

export function loadExtraRecipients(projectId) {
  try {
    const raw = localStorage.getItem(`${EXTRA_KEY}_${projectId || 'all'}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r) => r?.email) : [];
  } catch {
    return [];
  }
}

export function saveExtraRecipients(projectId, list) {
  try {
    localStorage.setItem(`${EXTRA_KEY}_${projectId || 'all'}`, JSON.stringify(mergeRecipients(list)));
  } catch {
    /* ignore */
  }
}
