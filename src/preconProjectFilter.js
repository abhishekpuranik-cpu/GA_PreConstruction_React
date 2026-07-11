/**
 * Project multi-filter: null = all, [] = none, [ids] = selected subset.
 */

export function projectFilterLabel(filter, { allWord = 'all' } = {}) {
  if (filter == null) return `(${allWord})`;
  if (!filter.length) return '(none)';
  return `(${filter.length} selected)`;
}

export function projectChipOn(filter, id) {
  return filter == null || filter.includes(id);
}

/** Toggle one project id within null/[]/[ids] semantics. */
export function toggleProjectFilter(prev, id, allIds) {
  const all = allIds || [];
  if (prev == null) return all.filter((x) => x !== id);
  if (prev.includes(id)) return prev.filter((x) => x !== id);
  const next = [...prev, id];
  return next.length >= all.length ? null : next;
}

/** Filter project list by selection state. */
export function applyProjectFilter(projects, filter) {
  const list = projects || [];
  if (filter == null) return list;
  if (!filter.length) return [];
  const set = new Set(filter);
  return list.filter((p) => set.has(p.id));
}

/** For buildMyWorkItems / buildPortfolioWorkItems — null/undefined = all. */
export function projectIdSetFromFilter(projectIds) {
  if (projectIds == null) return null;
  return new Set(projectIds);
}
