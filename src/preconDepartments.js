/**
 * Department heads (editable) and phase → department mapping for filters.
 * Role placeholders on tasks come from cemeLifecycle / Process sheet (task.roles).
 */

export const DEPARTMENTS_VERSION = 1;

/** @typedef {{ id: string, name: string, head: string, phaseSlugs: string[], phaseNames?: string[] }} Department */

/** Default department heads per user specification */
export const DEFAULT_DEPARTMENTS = [
  {
    id: 'dept_design',
    name: 'Design & Approvals',
    head: 'Minal Madam',
    phaseSlugs: ['design_approvals'],
    phaseNames: ['design & approvals', 'design & team appointments', 'regulatory approvals'],
  },
  {
    id: 'dept_acquisition',
    name: 'Acquisition, Finance & Sales Office',
    head: 'Amit Dhumal (Amit)',
    phaseSlugs: [
      'land_acquisition_feasibility',
      'registration',
      'project_financial_working',
      'project_finnancial_working',
      'financing_pre_construction',
      'sales_office_setup',
    ],
    phaseNames: [
      'land acquisition & feasibility',
      'land acquisition',
      'registration',
      'project financial working',
      'project finnancial working',
      'financing & pre-construction',
      'sales office setup',
      'technical & legal due diligence',
    ],
  },
  {
    id: 'dept_execution',
    name: 'Execution & Commercial',
    head: 'Abhishek',
    phaseSlugs: [
      'site_preparation',
      'marketing_sales',
      'handover_post_sales',
      'closure_exit',
    ],
    phaseNames: [
      'site preparation',
      'construction execution',
      'marketing & sales',
      'handover & post-sales',
      'handover & post sales',
      'closure & exit',
      'construction pre-requisite',
      'pre-work start follow-up (before site works)',
    ],
  },
];

function normPhaseName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeDepartments(raw) {
  if (!Array.isArray(raw) || !raw.length) {
    return DEFAULT_DEPARTMENTS.map((d) => ({ ...d, phaseNames: [...(d.phaseNames || [])] }));
  }
  return raw.map((d) => {
    const def = DEFAULT_DEPARTMENTS.find((x) => x.id === d.id);
    return {
      id: d.id || def?.id || `dept_${Date.now()}`,
      name: d.name || def?.name || 'Department',
      head: typeof d.head === 'string' ? d.head : def?.head || '',
      phaseSlugs: d.phaseSlugs || def?.phaseSlugs || [],
      phaseNames: d.phaseNames || def?.phaseNames || [],
    };
  });
}

export function getDepartmentForPhase(phaseName, departments = DEFAULT_DEPARTMENTS) {
  const n = normPhaseName(phaseName);
  if (!n) return null;
  for (const dept of departments) {
    if ((dept.phaseNames || []).some((pn) => n === pn || n.includes(pn) || pn.includes(n))) {
      return dept;
    }
    const slug = n.replace(/\s+/g, '_');
    if ((dept.phaseSlugs || []).some((s) => slug.includes(s) || s.includes(slug))) {
      return dept;
    }
  }
  if (/design|regulatory|approval|architect|iod|sanction|noc/i.test(n)) {
    return departments.find((d) => d.id === 'dept_design') || null;
  }
  if (/land|registration|financial|financing|feasibility|sales office|due diligence|scout/i.test(n)) {
    return departments.find((d) => d.id === 'dept_acquisition') || null;
  }
  return departments.find((d) => d.id === 'dept_execution') || null;
}

export function getTaskDepartment(task, phaseName, departments) {
  return getDepartmentForPhase(phaseName, departments);
}

export function formatRoles(task) {
  const r = task?.roles;
  if (Array.isArray(r)) return r.filter(Boolean).join(', ');
  if (typeof r === 'string') return r.trim();
  return '';
}

export function parseRolesInput(text) {
  if (!text || !String(text).trim()) return [];
  return String(text)
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function taskMatchesDepartment(task, phaseName, departmentId, departments) {
  if (!departmentId) return true;
  const dept = getTaskDepartment(task, phaseName, departments);
  return dept?.id === departmentId;
}

export function taskMatchesRoleFilter(task, roleFilter) {
  if (!roleFilter) return true;
  const f = roleFilter.toLowerCase();
  const roles = Array.isArray(task.roles) ? task.roles : parseRolesInput(task.roles);
  if (roles.some((r) => r.toLowerCase().includes(f) || f.includes(r.toLowerCase()))) return true;
  if (String(task.who || '').toLowerCase().includes(f)) return true;
  return false;
}

export function collectAllRoles(projects) {
  const set = new Set();
  (projects || []).forEach((proj) => {
    (proj.phases || []).forEach((ph) => {
      (ph.tasks || []).forEach((t) => {
        const roles = Array.isArray(t.roles) ? t.roles : parseRolesInput(t.roles);
        roles.forEach((r) => {
          if (r) set.add(r);
        });
      });
    });
  });
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function ensureStateDepartments(state) {
  if (!state || typeof state !== 'object') return { departments: normalizeDepartments(null) };
  if (!state.departments || !state.departmentsVersion) {
    state.departments = normalizeDepartments(null);
    state.departmentsVersion = DEPARTMENTS_VERSION;
  } else {
    state.departments = normalizeDepartments(state.departments);
  }
  return state;
}
