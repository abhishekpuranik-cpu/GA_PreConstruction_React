import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpeechDictationButton } from './SpeechDictationButton.jsx';
import { ANALYTICS_PROMPT_EXAMPLES } from './preconAnalyticsContext.js';
import { applyAnalyticsAction, askPreconAnalytics } from './preconAnalyticsClient.js';
import { joinTranscript, useSpeechDictation } from './useSpeechDictation.js';
import { AskAnswerVisuals } from './AskAnswerVisuals.jsx';

const C = { navy: '#1A304A', tx2: '#55504A', tx3: '#96918A', gold: '#9A6E20' };

export function AnalyticsAskView({
  projects = [],
  dispatch,
  toast,
  onOpenProject,
  loginUser,
}) {
  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [history, setHistory] = useState([]);
  const abortRef = useRef(null);

  const onSpeechFinal = useCallback((fieldId, chunk) => {
    if (fieldId !== 'ask') return;
    setQuestion((prev) => joinTranscript(prev, chunk));
  }, []);

  const speech = useSpeechDictation({
    onFinal: onSpeechFinal,
    lang: 'en-IN',
    disabled: busy,
  });

  useEffect(() => {
    if (!speech.error || !toast) return;
    toast(speech.error, 'err');
    speech.clearError();
  }, [speech.error, toast, speech.clearError]);

  const displayQ =
    speech.listening && speech.activeField === 'ask' && speech.interim
      ? joinTranscript(question, speech.interim)
      : question;

  const projectOptions = useMemo(
    () => [...(projects || [])].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [projects],
  );

  const runAsk = async (qOverride) => {
    let q = String(qOverride != null ? qOverride : question).trim();
    if (speech.listening && speech.interim && speech.activeField === 'ask') {
      q = joinTranscript(qOverride != null ? qOverride : question, speech.interim).trim();
    }
    speech.stop();
    if (!q) {
      toast?.('Ask a question first', 'err');
      return;
    }
    setQuestion(q);
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setAnswer(null);
    try {
      const result = await askPreconAnalytics({
        question: q,
        projects,
        projectId: projectId || null,
        person: loginUser?.name || '',
        signal: ac.signal,
      });
      setAnswer(result);
      setHistory((h) => [{ q, at: new Date().toISOString(), source: result.source }, ...h].slice(0, 12));
      if (result.warning) toast?.(result.warning, 'ok');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      toast?.(e?.message || 'Ask failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = (action) => {
    if (!action) return;
    const msg = `${action.label || action.type}\n\n${action.rationale || ''}\n\nApply this change? (Remember to click Save after.)`;
    if (!window.confirm(msg)) return;
    applyAnalyticsAction(action, { dispatch, onOpenProject, toast });
  };

  return (
    <div className="ask-root">
      <header className="ask-hero">
        <p className="ask-eyebrow">Prompt analytics</p>
        <h1 className="ask-title disp">Ask PreConstruction</h1>
        <p className="ask-sub">
          Ask anything — bottlenecks, forecasts, workload, compliance, what to do next.
          Answers are grounded in live project data. Suggested changes always need your confirmation.
        </p>
      </header>

      <div className="ask-box card">
        <div className="ask-box-top">
          <label className="ask-scope">
            <span>Scope</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
              <option value="">All projects (portfolio)</option>
              {projectOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <SpeechDictationButton
            fieldId="ask"
            activeField={speech.activeField}
            listening={speech.listening}
            supported={speech.supported}
            disabled={busy}
            onToggle={speech.toggle}
            titleIdle="Dictate your question"
            titleListening="Stop listening"
          />
        </div>

        <textarea
          className="ask-input"
          rows={3}
          value={displayQ}
          disabled={busy}
          placeholder="e.g. What are the current bottlenecks, and what should leadership do this week?"
          onChange={(e) => {
            if (speech.listening && speech.activeField === 'ask') speech.stop();
            setQuestion(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              runAsk();
            }
          }}
        />
        {speech.listening && speech.activeField === 'ask' ? (
          <p className="ask-mic-hint">Listening — speak your question. Tap ⏹ when done, then Ask.</p>
        ) : null}

        <div className="ask-actions">
          <button type="button" className="btp" disabled={busy || !String(displayQ).trim()} onClick={() => runAsk()}>
            {busy ? 'Analyzing…' : 'Ask'}
          </button>
          <button
            type="button"
            className="btg"
            disabled={busy}
            onClick={() => {
              speech.stop();
              setQuestion('');
              setAnswer(null);
            }}
          >
            Clear
          </button>
          <span className="ask-kbd">Ctrl/⌘ + Enter</span>
        </div>

        <div className="ask-examples">
          {ANALYTICS_PROMPT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="ask-chip"
              disabled={busy}
              onClick={() => {
                setQuestion(ex);
                runAsk(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {answer ? (
        <section className="ask-answer card">
          <div className="ask-answer-meta">
            <span className={`ask-source ask-source-${answer.source || 'local'}`}>
              {answer.source === 'llm' ? `AI · ${answer.model || 'model'}` : 'Local analytics engine'}
            </span>
            {answer.intent ? <span className="ask-intent">{answer.intent}</span> : null}
            {answer.highlights ? (
              <span className="ask-hl">
                Overdue {answer.highlights.overdue ?? '—'} · NA overdue {answer.highlights.nextActionOverdue ?? '—'} ·
                Breaches {answer.highlights.complianceBreaches ?? '—'}
              </span>
            ) : null}
          </div>
          {answer.warning ? <p className="ask-warn">{answer.warning}</p> : null}
          {answer.error && !answer.markdown && !answer.sections?.length ? <p className="ask-warn">{answer.error}</p> : null}
          <AskAnswerVisuals answer={answer} />

          {answer.proposedActions?.length ? (
            <div className="ask-proposals">
              <h3 className="ask-md-h4">Suggested changes (confirm to apply)</h3>
              <p className="ask-sub" style={{ margin: '0 0 10px' }}>
                Nothing is changed until you confirm. Then click <strong>Save</strong> in the top bar to sync.
              </p>
              <ul className="ask-proposal-list">
                {answer.proposedActions.map((a, idx) => (
                  <li key={`${a.type}-${a.tId || idx}-${idx}`}>
                    <div>
                      <strong>{a.label || a.type}</strong>
                      {a.rationale ? <div className="ask-proposal-why">{a.rationale}</div> : null}
                    </div>
                    <button type="button" className="bts" onClick={() => confirmAction(a)}>
                      Confirm
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {history.length ? (
        <section className="ask-history">
          <h3 className="ask-md-h4">Recent questions</h3>
          <ul>
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <button type="button" className="ask-hist-btn" disabled={busy} onClick={() => runAsk(h.q)}>
                  {h.q}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="ask-footnote" style={{ color: C.tx3 }}>
        Tip: set <code>ANTHROPIC_API_KEY</code> on the server for richer LLM answers. Without it, the local engine still
        answers from live metrics.
      </p>
    </div>
  );
}
