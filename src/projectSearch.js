/** Match project against a free-text query (name, location, id). */
export function projectMatchesSearch(project, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const name = String(project?.name || '').toLowerCase();
  const loc = String(project?.loc || '').toLowerCase();
  const id = String(project?.id || '').toLowerCase();
  const type = String(project?.type || '').toLowerCase();
  return name.includes(q) || loc.includes(q) || id.includes(q) || type.includes(q);
}

export function filterProjectsBySearch(projects, query) {
  const list = projects || [];
  const q = String(query || '').trim();
  if (!q) return list;
  return list.filter((p) => projectMatchesSearch(p, q));
}

function kickoffSortKey(project) {
  const ko = String(project?.ko || '').trim();
  if (!ko) return Number.POSITIVE_INFINITY;
  const t = Date.parse(ko);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** True when project location is Goa (Dashboard deprioritizes these to the bottom). */
export function isGoaProject(project) {
  return String(project?.loc || '').trim().toLowerCase().includes('goa');
}

/** Earliest kickoff first; ties broken by project name. Goa projects last; no-kickoff last within each group. */
export function sortProjectsByKickoff(projects) {
  return [...(projects || [])].sort((a, b) => {
    const ga = isGoaProject(a) ? 1 : 0;
    const gb = isGoaProject(b) ? 1 : 0;
    if (ga !== gb) return ga - gb;
    const ka = kickoffSortKey(a);
    const kb = kickoffSortKey(b);
    if (ka !== kb) return ka - kb;
    return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
  });
}

export function filterAndSortProjects(projects, query) {
  return sortProjectsByKickoff(filterProjectsBySearch(projects, query));
}
