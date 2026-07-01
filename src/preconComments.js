/** @returns {string|null} Error message or null if valid */
export function validateCommentPayload({ text, nextAction, nextActionDate }) {
  if (!String(text || '').trim()) return 'Enter a comment';
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
    const raw = comments.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(normalizeCommentRow).filter(Boolean);
    } catch {
      /* plain text */
    }
    return [{ author: 'Note', ts: '', text: raw }];
  }
  if (!Array.isArray(comments)) return [];
  return comments.map(normalizeCommentRow).filter(Boolean);
}

function normalizeCommentRow(c) {
  if (c == null) return null;
  if (typeof c === 'string') {
    const text = c.trim();
    return text ? { author: 'Note', ts: '', text } : null;
  }
  if (typeof c !== 'object') return null;
  const text = String(c.text ?? c.comment ?? c.body ?? c.message ?? c.note ?? '').trim();
  const nextAction = String(c.nextAction ?? c.next_action ?? c.nextActionText ?? '').trim();
  const nextActionDate = String(c.nextActionDate ?? c.next_action_date ?? c.due ?? c.dueDate ?? '').trim();
  if (!text && !nextAction && !nextActionDate) return null;
  return {
    ...c,
    text,
    nextAction,
    nextActionDate,
    author: c.author || c.by || c.user || 'Anon',
    ts: c.ts || c.date || c.createdAt || '',
  };
}

/** Oldest first; preserves stable order for equal/unknown timestamps. */
export function sortCommentsChronologically(comments) {
  return normalizeTaskComments(comments)
    .map((comment, index) => ({ comment, index }))
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
  return (comments || []).length;
}
