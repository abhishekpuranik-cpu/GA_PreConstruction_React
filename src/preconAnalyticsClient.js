import { answerAnalyticsLocally } from './preconAnalyticsLocal.js';
import { buildAnalyticsContext } from './preconAnalyticsContext.js';

/**
 * Ask analytics: try server LLM, always fall back to local grounded engine.
 */
export async function askPreconAnalytics({
  question,
  projects,
  projectId = null,
  person = '',
  signal,
} = {}) {
  const q = String(question || '').trim();
  if (!q) {
    return { ok: false, error: 'Enter a question', source: 'none' };
  }

  const context = buildAnalyticsContext(projects, { projectId, person });
  const local = answerAnalyticsLocally(q, context);

  try {
    const res = await fetch('/api/preconstruction/analytics-ask', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        question: q,
        context,
        preferLlm: true,
      }),
    });

    if (res.status === 401 || res.status === 403) {
      return {
        ...local,
        warning: 'Signed-in AI assist unavailable — showing local analytics.',
      };
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ...local,
        warning: data.error || data.message || `AI assist unavailable (${res.status}) — local answer shown.`,
      };
    }

    if (data?.skippedLlm || data?.source === 'local') {
      return {
        ...local,
        warning: data?.reason || 'AI key not configured — local analytics engine used.',
        llmAvailable: false,
      };
    }

    return {
      ok: true,
      source: data.source || 'llm',
      intent: data.intent || local.intent,
      markdown: data.markdown || local.markdown,
      sections: data.sections || local.sections,
      highlights: data.highlights || local.highlights,
      proposedActions: Array.isArray(data.proposedActions) && data.proposedActions.length
        ? data.proposedActions
        : local.proposedActions,
      model: data.model || '',
      llmAvailable: true,
      localFallback: local,
    };
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    return {
      ...local,
      warning: e?.message || 'Network error — local analytics shown.',
    };
  }
}

/**
 * Apply a confirmed proposed action through the existing reducer.
 */
export function applyAnalyticsAction(action, { dispatch, onOpenProject, toast }) {
  if (!action || !dispatch) return false;
  const type = String(action.type || '');

  if (type === 'openProject') {
    if (action.projId && onOpenProject) onOpenProject(action.projId);
    toast?.('Opened project', 'ok');
    return true;
  }

  if (type === 'markDone') {
    if (!action.projId || !action.phId || !action.tId) return false;
    dispatch({ type: 'markDone', projId: action.projId, phId: action.phId, tId: action.tId });
    toast?.('Marked complete — click Save to sync', 'ok');
    if (action.openProject && onOpenProject) onOpenProject(action.projId);
    return true;
  }

  if (type === 'setTaskStatus') {
    if (!action.projId || !action.phId || !action.tId) return false;
    const v = action.fields?.status || action.status || 'inprogress';
    dispatch({ type: 'setTaskStatus', projId: action.projId, phId: action.phId, tId: action.tId, v });
    toast?.(`Status set to ${v} — click Save to sync`, 'ok');
    if (action.openProject && onOpenProject) onOpenProject(action.projId);
    return true;
  }

  if (type === 'updTask') {
    if (!action.projId || !action.phId || !action.tId || !action.fields) return false;
    Object.entries(action.fields).forEach(([f, v]) => {
      dispatch({ type: 'updTask', projId: action.projId, phId: action.phId, tId: action.tId, f, v });
    });
    toast?.('Task updated — click Save to sync', 'ok');
    if (action.openProject && onOpenProject) onOpenProject(action.projId);
    return true;
  }

  if (type === 'addComment') {
    if (!action.projId || !action.phId || !action.tId || !action.comment) return false;
    dispatch({
      type: 'addComment',
      projId: action.projId,
      phId: action.phId,
      tId: action.tId,
      comment: action.comment,
    });
    toast?.('Comment added — click Save to sync', 'ok');
    if (action.openProject && onOpenProject) onOpenProject(action.projId);
    return true;
  }

  toast?.(`Unsupported action: ${type}`, 'err');
  return false;
}
