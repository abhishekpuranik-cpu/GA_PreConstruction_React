/**
 * View-layer Design vs Approval bifurcation.
 * Does NOT mutate Mongo/project shape — only partitions tasks for display.
 */
import lifecycleData from './data/cemeLifecycle.json';

const DESIGN_GROUPS = new Set(['team creation', 'initial studies', 'design']);
const APPROVAL_GROUPS = new Set(['approvals', 'regulatory obligations']);

const COMBINED_PHASE = /design\s*&\s*approvals/i;
const DESIGN_PHASE = /design\s*&\s*team|design\s*&\s*approval|^design$/i;
const APPROVAL_PHASE = /regulatory\s*approval|^approval/i;

const APPROVAL_NAME =
  /regulatory|approval|\bnoc\b|\biod\b|sanction|\brera\b|\bmpcb\b|\bec\b|consent to establish|geo.?tag|plantation|sewer|water supply|traffic|airport|swatch|fire noc|building plan|environmental/i;
const DESIGN_NAME =
  /^design:|^team:|architect|appoint |master plan|layout|mep|structural|soil|landscape|unit plan|fire & life|pmc|consultant/i;

/** Map template task id / normalized name → design | approval */
const TEMPLATE_SIDE = (() => {
  const byId = new Map();
  const byName = new Map();
  for (const ph of lifecycleData.phases || []) {
    if (String(ph.slug || '') !== 'design_approvals' && !COMBINED_PHASE.test(ph.name || '')) continue;
    for (const tpl of ph.tasks || []) {
      const group = String(tpl.phaseGroup || tpl.subPhase || '')
        .toLowerCase()
        .trim();
      let side = null;
      if (DESIGN_GROUPS.has(group)) side = 'design';
      else if (APPROVAL_GROUPS.has(group)) side = 'approval';
      else if (APPROVAL_NAME.test(`${tpl.workArea || ''} ${tpl.name || ''}`)) side = 'approval';
      else if (DESIGN_NAME.test(`${tpl.workArea || ''} ${tpl.name || ''}`)) side = 'design';
      if (!side) continue;
      if (tpl.id) byId.set(String(tpl.id), side);
      const label = String(tpl.workArea ? `${tpl.workArea}: ${tpl.name}` : tpl.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (label) byName.set(label, side);
      const bare = String(tpl.name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (bare) byName.set(bare, side);
    }
  }
  return { byId, byName };
})();

function normLabel(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function templateTail(taskId) {
  const parts = String(taskId || '').split('_');
  // e.g. ghq_design_approvals_039 → design_approvals_039
  const idx = parts.findIndex((p) => p === 'design' || p === 'approvals' || /^design/.test(p));
  if (idx >= 0) return parts.slice(idx).join('_');
  if (parts.length >= 2) return parts.slice(1).join('_');
  return String(taskId || '');
}

/** Classify a task as design | approval | null (unknown). */
export function classifyDesignApprovalTask(task) {
  if (!task) return null;
  const tail = templateTail(task.id);
  if (TEMPLATE_SIDE.byId.has(tail)) return TEMPLATE_SIDE.byId.get(tail);
  if (TEMPLATE_SIDE.byId.has(String(task.id))) return TEMPLATE_SIDE.byId.get(String(task.id));

  const name = normLabel(task.name);
  if (TEMPLATE_SIDE.byName.has(name)) return TEMPLATE_SIDE.byName.get(name);
  // Strip "WorkArea: " prefix variants
  const afterColon = name.includes(':') ? name.split(':').slice(1).join(':').trim() : '';
  if (afterColon && TEMPLATE_SIDE.byName.has(afterColon)) return TEMPLATE_SIDE.byName.get(afterColon);

  if (/^regulatory approvals:/.test(name) || APPROVAL_NAME.test(task.name || '')) return 'approval';
  if (/^design:|^team:/.test(name) || DESIGN_NAME.test(task.name || '')) return 'design';
  return null;
}

function classifyPhaseKind(phaseName) {
  const n = String(phaseName || '');
  if (COMBINED_PHASE.test(n)) return 'combined';
  if (APPROVAL_PHASE.test(n) && !/design/i.test(n)) return 'approval';
  if (DESIGN_PHASE.test(n)) return 'design';
  return 'other';
}

/**
 * Expand project phases into display sections.
 * Combined "Design & Approvals" → Design + Approval.
 * Legacy dual phases → labeled Design / Approval.
 * Other phases unchanged.
 * Virtual sections keep `_sourcePhaseId` for mutations.
 */
export function expandPhasesForDisplay(phases) {
  const out = [];
  for (const ph of phases || []) {
    const kind = classifyPhaseKind(ph.name);
    if (kind === 'combined') {
      const designTasks = [];
      const approvalTasks = [];
      for (const t of ph.tasks || []) {
        const side = classifyDesignApprovalTask(t);
        if (side === 'approval') approvalTasks.push(t);
        else designTasks.push(t);
      }
      if (designTasks.length) {
        out.push({
          ...ph,
          id: `${ph.id}__design`,
          name: 'Design',
          tasks: designTasks,
          open: ph.open !== false,
          _sourcePhaseId: ph.id,
          _section: 'design',
        });
      }
      if (approvalTasks.length) {
        out.push({
          ...ph,
          id: `${ph.id}__approval`,
          name: 'Approval',
          col: ph.col || '#B32E1E',
          tasks: approvalTasks,
          open: ph.open !== false,
          _sourcePhaseId: ph.id,
          _section: 'approval',
        });
      }
      if (!designTasks.length && !approvalTasks.length) out.push(ph);
      continue;
    }
    if (kind === 'design') {
      out.push({
        ...ph,
        name: 'Design',
        _sourcePhaseId: ph.id,
        _section: 'design',
      });
      continue;
    }
    if (kind === 'approval') {
      out.push({
        ...ph,
        name: 'Approval',
        _sourcePhaseId: ph.id,
        _section: 'approval',
      });
      continue;
    }
    out.push(ph);
  }
  return out;
}

/** Real phase id for reducer actions (virtual Design/Approval sections). */
export function realPhaseId(ph) {
  return ph?._sourcePhaseId || ph?.id;
}
