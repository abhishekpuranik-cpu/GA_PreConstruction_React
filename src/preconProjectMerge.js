/** Deep merge PreConstruction projects — union phases and tasks by id (409 / team sync). */

function mergeTaskRow(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const exComments = Array.isArray(existing.comments) ? existing.comments.length : 0;
  const inComments = Array.isArray(incoming.comments) ? incoming.comments.length : 0;
  const exAtt = Array.isArray(existing.attachments) ? existing.attachments.length : 0;
  const inAtt = Array.isArray(incoming.attachments) ? incoming.attachments.length : 0;
  return {
    ...existing,
    ...incoming,
    comments: inComments >= exComments ? incoming.comments : existing.comments,
    attachments: inAtt >= exAtt ? incoming.attachments : existing.attachments,
    msManual: incoming.msManual ?? existing.msManual,
    source: incoming.source || existing.source,
  };
}

function mergePhaseTasks(exTasks, inTasks) {
  const exList = Array.isArray(exTasks) ? exTasks : [];
  const inList = Array.isArray(inTasks) ? inTasks : [];
  const exMap = new Map(exList.map((t) => [String(t.id), t]));
  const inMap = new Map(inList.map((t) => [String(t.id), t]));
  const ordered = [];
  const seen = new Set();

  for (const t of inList) {
    const id = String(t.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(mergeTaskRow(exMap.get(id), t));
  }
  for (const t of exList) {
    const id = String(t.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(t);
  }
  return ordered;
}

function mergePhases(exPhases, inPhases) {
  const exList = Array.isArray(exPhases) ? exPhases : [];
  const inList = Array.isArray(inPhases) ? inPhases : [];
  const exMap = new Map(exList.map((ph) => [String(ph.id), ph]));
  const inMap = new Map(inList.map((ph) => [String(ph.id), ph]));
  const ordered = [];
  const seen = new Set();

  for (const ph of inList) {
    const id = String(ph.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const exPh = exMap.get(id);
    ordered.push({
      ...(exPh || {}),
      ...ph,
      tasks: mergePhaseTasks(exPh?.tasks, ph.tasks),
    });
  }
  for (const ph of exList) {
    const id = String(ph.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(ph);
  }
  return ordered;
}

/** Union phases/tasks by id; scalar project fields prefer incoming. */
export function mergeProjectDeep(existing, incoming) {
  if (!existing || typeof existing !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return existing;
  return {
    ...existing,
    ...incoming,
    phases: mergePhases(existing.phases, incoming.phases),
  };
}

export function countProjectTasks(proj) {
  let n = 0;
  for (const ph of proj?.phases || []) {
    if (Array.isArray(ph?.tasks)) n += ph.tasks.length;
  }
  return n;
}
