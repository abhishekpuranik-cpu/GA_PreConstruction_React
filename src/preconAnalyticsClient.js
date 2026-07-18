import { answerAnalyticsLocally } from './preconAnalyticsLocal.js';
import { buildAnalyticsContext } from './preconAnalyticsContext.js';
import { tryAnswerProjectStatusQuestion } from './preconAskBrief.js';

/**
 * Merge LLM narrative onto a fact-locked local answer.
 * Numbers, sections, charts, and highlights always stay local when lockFacts is set.
 */
function mergeNarrateOnly(local, llm) {
  if (!local?.lockFacts) {
    return {
      ok: true,
      source: llm.source || 'llm',
      intent: llm.intent || local.intent,
      headline: llm.headline || local.headline,
      markdown: llm.markdown || local.markdown,
      sections: Array.isArray(llm.sections) && llm.sections.length ? llm.sections : local.sections,
      charts: Array.isArray(llm.charts) && llm.charts.length ? llm.charts : local.charts,
      highlights: llm.highlights && Object.keys(llm.highlights).length ? llm.highlights : local.highlights,
      proposedActions:
        Array.isArray(llm.proposedActions) && llm.proposedActions.length
          ? llm.proposedActions
          : local.proposedActions,
      model: llm.model || '',
      llmAvailable: true,
      localFallback: local,
      lockFacts: false,
    };
  }

  const narrative = String(llm.narrative || llm.markdown || '').trim();
  const sections = [...(local.sections || [])];
  if (narrative) {
    sections.unshift({
      kind: 'informative',
      title: 'Narrative (LLM — grounded on the facts below)',
      narrative: narrative.slice(0, 4000),
    });
  }

  const mdParts = [];
  if (narrative) {
    mdParts.push('### Narrative', '', narrative, '', '---', '');
  }
  mdParts.push(local.markdown || '');

  return {
    ...local,
    ok: true,
    source: 'local+llm',
    model: llm.model || '',
    llmAvailable: true,
    sections,
    markdown: mdParts.join('\n'),
    // Never take LLM numbers/charts/actions over the brief
    charts: local.charts,
    highlights: local.highlights,
    proposedActions: local.proposedActions,
    headline: local.headline,
    lockFacts: true,
    localFallback: local,
  };
}

/**
 * Ask analytics: fact-locked project briefs first; LLM may narrate but cannot invent numbers.
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

  const briefLocal = tryAnswerProjectStatusQuestion(q, projects, { projectId });
  const context = buildAnalyticsContext(projects, { projectId, person });
  if (briefLocal?.evidence) {
    context.projectBrief = briefLocal.evidence;
  }
  const local = briefLocal || answerAnalyticsLocally(q, context);
  const preferNarrateOnly = !!local.lockFacts;

  try {
    const res = await fetch('/api/preconstruction/analytics-ask', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        question: q,
        context,
        localAnswer: {
          intent: local.intent,
          headline: local.headline,
          highlights: local.highlights,
          lockFacts: !!local.lockFacts,
          evidence: local.evidence || local.projectBrief || null,
          markdown: local.markdown,
        },
        preferLlm: true,
        preferNarrateOnly,
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

    return mergeNarrateOnly(local, data);
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
