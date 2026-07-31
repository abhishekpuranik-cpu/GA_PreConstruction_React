/**
 * Context-aware grammar / spelling check via platform Anthropic endpoint.
 */
export async function checkGrammar(text, { field = 'comment', context = {}, signal } = {}) {
  const body = String(text || '');
  if (!body.trim()) {
    return { ok: true, corrections: [], correctedText: '', unchanged: true };
  }
  const res = await fetch('/api/preconstruction/grammar-check', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      text: body,
      field,
      context: {
        projectName: context.projectName || '',
        phaseName: context.phaseName || '',
        taskName: context.taskName || '',
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'Sign in required for grammar check', corrections: [], correctedText: body };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error || `Grammar check failed (${res.status})`,
      corrections: [],
      correctedText: body,
    };
  }
  if (data?.skippedLlm) {
    return {
      ok: false,
      error: data.reason || 'Grammar assist unavailable on server',
      corrections: [],
      correctedText: body,
      skippedLlm: true,
    };
  }
  return {
    ok: true,
    corrections: Array.isArray(data.corrections) ? data.corrections : [],
    correctedText: typeof data.correctedText === 'string' ? data.correctedText : body,
    unchanged: !!data.unchanged,
    source: data.source,
  };
}

export function applyCorrectionAt(text, correction) {
  const src = String(text || '');
  const c = correction || {};
  if (c.start == null || c.end == null) return src;
  if (src.slice(c.start, c.end) !== c.original) {
    const at = src.indexOf(c.original);
    if (at < 0) return src;
    return `${src.slice(0, at)}${c.suggestion}${src.slice(at + c.original.length)}`;
  }
  return `${src.slice(0, c.start)}${c.suggestion}${src.slice(c.end)}`;
}

export function applyAllGrammarCorrections(text, corrections) {
  let next = String(text || '');
  const ordered = [...(corrections || [])].sort((a, b) => b.start - a.start);
  for (const c of ordered) {
    next = applyCorrectionAt(next, c);
  }
  return next;
}
