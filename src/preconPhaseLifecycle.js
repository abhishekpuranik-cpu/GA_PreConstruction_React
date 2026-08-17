const LIFECYCLE_RULES = [
  { label: '1', order: 100, test: /\bland acquisition\b|\bland scouting\b|\bscouting\b|\bfeasibility of land\b/ },
  { label: '1', order: 110, test: /\btechnical\b.*\blegal\b.*\bdue diligence\b|\bdue diligence\b|\bterm sheet\b|\bmou\b|\bspv\b|\bfund raising\b.*\bland\b/ },
  { label: '2', order: 200, test: /\bproject financial working\b|\bmarket stud(?:y|ies)\b|\bproject feasibility check\b|\bmassing\b|\bcosting\b|\bprofitability\b|\birr\b/ },
  { label: '4', order: 480, test: /\brera\b|\bregulatory approval\b|\bregulatory obligation\b/ },
  { label: '3', order: 300, test: /^registration$|\bproject registration\b/ },
  { label: '4', order: 400, test: /^design$|\bdesign and approvals?\b|\bteam creation\b|\binitial studies\b|\barchitect\b/ },
  { label: '4', order: 450, test: /^approvals?$|\bapproval\b|\bregulatory\b/ },
  { label: '5', order: 500, test: /\bfinancing\b.*\bpre construction\b|\bpre construction financing\b/ },
  { label: '5', order: 520, test: /\bconstruction prerequisite\b|\btendering\b|\bcontracts?\b|\bmobilization\b|\bpre construction\b/ },
  { label: '6', order: 600, test: /\bconstruction execution\b/ },
  { label: '6', order: 610, test: /\bsite prep(?:aration)?\b|\bdemolition\b/ },
  { label: '6', order: 620, test: /\bexcavation\b/ },
  { label: '6', order: 630, test: /\bfoundation\b|\bsub structure\b|\bwaterproofing\b/ },
  { label: '6', order: 640, test: /\bstructure\b|\bquality\b/ },
  { label: '6', order: 650, test: /\bmasonry\b|\bplaster\b/ },
  { label: '6', order: 660, test: /\belectrical\b|\bplumbing\b|\bhvac\b|\bfirefighting\b|\belevators?\b|\bfacade\b|\bjoinery\b|\bflooring\b|\bpainting\b/ },
  { label: '6', order: 670, test: /\bexternal works\b|\blandscape\b|\butilities\b|\bsafety\b/ },
  { label: '7B', order: 750, test: /\bsales office\b/ },
  { label: '7', order: 700, test: /\bmarketing\b|\bsales crm\b|\bbranding\b|\bsales launch\b/ },
  { label: '8', order: 800, test: /\bhandover\b|\bpost sales\b|\bpossession\b|\bsnagging\b|\bsociety\b|\bdlp\b/ },
  { label: '9', order: 900, test: /\bclosure\b|\bexit\b|\bfm transition\b|\blessons\b/ },
  { label: '10', order: 1000, test: /\bproperty management\b|\bmanagement services\b/ },
];

export function normalizePhaseName(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(?:finnancial|finacial)\b/g, 'financial')
    .replace(/\btehcnical\b/g, 'technical')
    .replace(/\bpre[\s-]*requisites?\b/g, 'prerequisite')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function phaseLifecycle(phase) {
  const name = normalizePhaseName(phase?.name);
  const taskText = (Array.isArray(phase?.tasks) ? phase.tasks : [])
    .slice(0, 24)
    .map((task) => normalizePhaseName(task?.name))
    .filter(Boolean)
    .join(' ');
  const searchable = `${name} ${taskText}`.trim();
  const match = LIFECYCLE_RULES.find((rule) => rule.test.test(name))
    || LIFECYCLE_RULES.find((rule) => rule.test.test(searchable));
  return match
    ? { label: match.label, order: match.order }
    : { label: '—', order: 1100 };
}

export function sortPhasesByLifecycle(phases) {
  return (Array.isArray(phases) ? phases : [])
    .map((phase, sourceIndex) => ({
      phase,
      sourceIndex,
      lifecycle: phaseLifecycle(phase),
    }))
    .sort((a, b) => (
      a.lifecycle.order - b.lifecycle.order
      || a.sourceIndex - b.sourceIndex
    ))
    .map(({ phase }) => phase);
}
