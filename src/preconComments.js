/** @returns {string|null} Error message or null if valid */
export function validateCommentPayload({ text, nextAction, nextActionDate, markComplete = false }) {
  if (!String(text || '').trim()) return 'Enter a comment';
  if (markComplete) return null;
  if (!String(nextAction || '').trim()) return 'Next action is required';
  if (!String(nextActionDate || '').trim()) return 'Next action date is required';
  return null;
}

/** Milliseconds since epoch for sorting; 0 if unknown. */
export function commentSortKey(c) {
  if (c?.createdAt) {
    const t = new Date(c.createdAt).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const raw = String(c?.ts || '').trim();
  if (!raw) return 0;
  let t = new Date(raw).getTime();
  if (!Number.isNaN(t)) return t;
  const dmy = raw.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (dmy) {
    t = new Date(`${dmy[1]} ${dmy[2]} ${dmy[3]}`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  const slash = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slash) {
    t = new Date(`${slash[1]}/${slash[2]}/${slash[3]}`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    t = new Date(raw.slice(0, 10)).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/** Coerce legacy / string / JSON comment fields into displayable objects. */
export function normalizeTaskComments(comments) {
  if (comments == null) return [];
  if (typeof comments === 'string') {
    return parseLegacyCommentString(comments);
  }
  if (!Array.isArray(comments)) {
    if (typeof comments === 'object') {
      const values = Object.values(comments);
      if (values.length) return normalizeTaskComments(values);
    }
    return [];
  }
  const rows = [];
  comments.forEach((entry) => {
    if (typeof entry === 'string' && entry.includes('[') && entry.includes(']')) {
      rows.push(...parseLegacyCommentString(entry));
      return;
    }
    const row = normalizeCommentRow(entry);
    if (row) rows.push(row);
  });
  return rows;
}

/** Split `[Author 1 Jan 2026] text | [Other 2 Jan 2026] more` into rows. */
export function parseLegacyCommentString(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map(normalizeCommentRow).filter(Boolean);
    if (parsed && typeof parsed === 'object') return normalizeTaskComments(parsed);
  } catch {
    /* plain text or formatted string */
  }
  if (text.includes('[') && text.includes(']')) {
    const chunks = text.split(/\s*\|\s*(?=\[)/).map((part) => part.trim()).filter(Boolean);
    if (chunks.length > 1 || /^\[.+\]/.test(chunks[0] || '')) {
      return chunks.map(parseBracketCommentChunk).filter(Boolean);
    }
  }
  return [{ author: 'Note', ts: '', text }];
}

function parseBracketCommentChunk(chunk) {
  const match = String(chunk || '').trim().match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (!match) return normalizeCommentRow(chunk);
  const meta = match[1].trim();
  let body = match[2].trim();
  let nextAction = '';
  let nextActionDate = '';
  const nextMatch = body.match(/\s*\|\s*Next:\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/i);
  if (nextMatch) {
    nextAction = String(nextMatch[1] || '').trim();
    nextActionDate = String(nextMatch[2] || '').trim();
    body = body.slice(0, nextMatch.index).trim();
  }
  const parts = meta.split(/\s+/);
  let author = meta;
  let ts = '';
  if (parts.length >= 3 && /\d/.test(parts[parts.length - 1])) {
    ts = parts.slice(-3).join(' ');
    author = parts.slice(0, -3).join(' ') || meta;
  } else if (parts.length >= 2) {
    ts = parts.slice(-2).join(' ');
    author = parts.slice(0, -2).join(' ') || meta;
  }
  return normalizeCommentRow({ author, ts, text: body, nextAction, nextActionDate });
}

function normalizeCommentRow(c) {
  if (c == null) return null;
  if (typeof c === 'string') {
    const text = c.trim();
    return text ? { author: 'Note', ts: '', text } : null;
  }
  if (typeof c !== 'object') return null;
  const text = String(c.text ?? c.comment ?? c.body ?? c.message ?? c.note ?? c.remarks ?? c.content ?? c.description ?? '').trim();
  const nextAction = String(c.nextAction ?? c.next_action ?? c.nextActionText ?? c.action ?? '').trim();
  const nextActionDate = String(c.nextActionDate ?? c.next_action_date ?? c.due ?? c.dueDate ?? c.actionDate ?? '').trim();
  if (!text && !nextAction && !nextActionDate) return null;
  return {
    ...c,
    text,
    nextAction,
    nextActionDate,
    author: c.author || c.by || c.user || c.name || c.authorName || 'Anon',
    ts: c.ts || c.date || c.time || c.createdAt || c.updatedAt || '',
  };
}

function commentDedupeKey(c) {
  return [
    String(c?.author || '').trim().toLowerCase(),
    String(c?.text || '').trim(),
    String(c?.nextAction || '').trim(),
    String(c?.nextActionDate || '').trim(),
    String(c?.createdAt || c?.ts || '').trim(),
  ].join('|');
}

/** Merge multiple normalized comment lists without duplicates. */
export function mergeCommentBuckets(lists) {
  const seen = new Set();
  const out = [];
  (lists || []).forEach((list) => {
    normalizeTaskComments(list).forEach((comment) => {
      const key = commentDedupeKey(comment);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(comment);
    });
  });
  return out;
}

export function normTaskKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function legacyTaskCommentSources(task) {
  const buckets = [];
  if (task?.comments != null) buckets.push(task.comments);
  if (task?.comment != null) buckets.push(task.comment);
  if (task?.commentLog != null) buckets.push(task.commentLog);
  if (task?.commentHistory != null) buckets.push(task.commentHistory);
  if (task?.remarks != null) buckets.push(task.remarks);
  if (typeof task?.remark === 'string' && task.remark.trim() && task.remark.trim() !== '-') {
    buckets.push([{ author: 'Note', text: task.remark.trim(), ts: '' }]);
  }
  if (typeof task?.notes === 'string' && task.notes.trim()) {
    buckets.push([{ author: 'Note', text: task.notes.trim(), ts: '' }]);
  }
  return buckets;
}

/**
 * Gather comments for display from the task and any same-named duplicates in the project.
 */
export function collectTaskComments(proj, ph, task, opts = {}) {
  const includeAliases = opts.includeAliases !== false;
  const buckets = legacyTaskCommentSources(task);
  if (includeAliases && proj && task?.name) {
    const key = normTaskKey(task.name);
    if (key) {
      for (const phase of proj.phases || []) {
        for (const sibling of phase.tasks || []) {
          if (sibling.id === task.id) continue;
          if (normTaskKey(sibling.name) !== key) continue;
          buckets.push(...legacyTaskCommentSources(sibling));
        }
      }
    }
  }
  return mergeCommentBuckets(buckets);
}

/** Oldest first; preserves stable order for equal/unknown timestamps. */
export function sortCommentsChronologically(comments) {
  return normalizeTaskComments(comments)
    .map((comment, index) => ({ comment: ensureCommentCreatedAt(comment), index }))
    .sort((a, b) => {
      const ka = commentSortKey(a.comment);
      const kb = commentSortKey(b.comment);
      if (ka !== kb) return ka - kb;
      return a.index - b.index;
    });
}

/** Newest first for display timelines. */
export function sortCommentsNewestFirst(comments) {
  return sortCommentsChronologically(comments).slice().reverse();
}

/** Backfill ISO createdAt from ts for legacy/imported rows. */
export function ensureCommentCreatedAt(c) {
  if (!c || c.createdAt) return c;
  const k = commentSortKey(c);
  if (k > 0) return { ...c, createdAt: new Date(k).toISOString() };
  return c;
}

export function formatCommentLine(c) {
  const base = `[${c.author || 'Anon'} ${c.ts || ''}] ${c.text || ''}`;
  const na = String(c.nextAction || '').trim();
  const nad = String(c.nextActionDate || '').trim();
  const att = (c.attachments || []).length
    ? ` | ${(c.attachments || []).length} file(s)`
    : '';
  if (na || nad) return `${base} | Next: ${na || '—'} (${nad || '—'})${att}`;
  return base + att;
}

/** Latest comment by chronological sort. */
export function getLatestComment(comments) {
  const sorted = sortCommentsChronologically(comments);
  return sorted.length ? sorted[sorted.length - 1].comment : null;
}

export function countComments(comments) {
  return normalizeTaskComments(comments).length;
}
