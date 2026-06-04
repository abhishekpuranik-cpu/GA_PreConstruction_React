/** @returns {string|null} Error message or null if valid */
export function validateCommentPayload({ text, nextAction, nextActionDate }) {
  if (!String(text || '').trim()) return 'Enter a comment';
  if (!String(nextAction || '').trim()) return 'Next action is required';
  if (!String(nextActionDate || '').trim()) return 'Next action date is required';
  return null;
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
