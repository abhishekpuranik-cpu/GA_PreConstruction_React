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

/** Oldest first; preserves stable order for equal/unknown timestamps. */
export function sortCommentsChronologically(comments) {
  return (comments || [])
    .map((comment, index) => ({ comment, index }))
    .sort((a, b) => {
      const ka = commentSortKey(a.comment);
      const kb = commentSortKey(b.comment);
      if (ka !== kb) return ka - kb;
      return a.index - b.index;
    });
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
