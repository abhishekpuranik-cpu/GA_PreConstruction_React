import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  applyAllGrammarCorrections,
  applyCorrectionAt,
  checkGrammar,
} from './preconGrammar.js';

/**
 * Gmail-style grammar/spelling assist: underline issues, click to accept, Fix all.
 */
export function GrammarAssistField({
  value,
  onChange,
  disabled = false,
  rows = 3,
  className = 'cform-textarea',
  placeholder = '',
  required = false,
  context = {},
  field = 'comment',
  toast,
  debounceMs = 1200,
}) {
  const wrapRef = useRef(null);
  const taRef = useRef(null);
  const backdropRef = useRef(null);
  const menuId = useId();
  const [corrections, setCorrections] = useState([]);
  const [checking, setChecking] = useState(false);
  const [activeIdx, setActiveIdx] = useState(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const lastCheckedRef = useRef('');
  const reqSeq = useRef(0);

  const syncScroll = () => {
    const ta = taRef.current;
    const bd = backdropRef.current;
    if (ta && bd) {
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    }
  };

  const runCheck = useCallback(
    async (text, { force = false } = {}) => {
      const trimmed = String(text || '');
      if (!trimmed.trim() || trimmed.trim().length < 8) {
        setCorrections([]);
        setActiveIdx(null);
        lastCheckedRef.current = trimmed;
        return;
      }
      if (!force && trimmed === lastCheckedRef.current) return;
      const seq = ++reqSeq.current;
      setChecking(true);
      try {
        const result = await checkGrammar(trimmed, { field, context });
        if (seq !== reqSeq.current) return;
        if (!result.ok) {
          if (force && toast) toast(result.error || 'Grammar check failed', 'err');
          setCorrections([]);
          setActiveIdx(null);
          return;
        }
        lastCheckedRef.current = trimmed;
        setCorrections(result.corrections || []);
        setActiveIdx(null);
        if (force && toast) {
          if (result.unchanged || !(result.corrections || []).length) {
            toast('Looks good — no grammar issues found', 'ok');
          } else {
            toast(
              `${result.corrections.length} suggestion${result.corrections.length === 1 ? '' : 's'}`,
              'ok',
            );
          }
        }
      } catch (e) {
        if (seq !== reqSeq.current) return;
        if (force && toast) toast(e?.message || 'Grammar check failed', 'err');
        setCorrections([]);
      } finally {
        if (seq === reqSeq.current) setChecking(false);
      }
    },
    [context, field, toast],
  );

  useEffect(() => {
    if (disabled) return undefined;
    const t = setTimeout(() => {
      void runCheck(value);
    }, debounceMs);
    return () => clearTimeout(t);
  }, [value, disabled, debounceMs, runCheck]);

  useEffect(() => {
    if (activeIdx == null) return undefined;
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setActiveIdx(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setActiveIdx(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [activeIdx]);

  const highlightNodes = useMemo(() => {
    const text = String(value || '');
    if (!corrections.length) {
      return text.endsWith('\n') ? `${text}\n` : text || '\u00a0';
    }
    const indexed = corrections
      .map((c, idx) => ({ ...c, idx }))
      .filter((c) => c.start >= 0 && c.end <= text.length && text.slice(c.start, c.end) === c.original)
      .sort((a, b) => a.start - b.start);
    const nodes = [];
    let cursor = 0;
    for (const c of indexed) {
      if (c.start < cursor) continue;
      if (c.start > cursor) nodes.push(text.slice(cursor, c.start));
      const kind = c.type === 'spelling' ? 'spelling' : 'grammar';
      nodes.push(
        <mark
          key={`g-${c.start}-${c.idx}`}
          className={`gram-mark gram-mark-${kind}${activeIdx === c.idx ? ' gram-mark-active' : ''}`}
        >
          {c.original}
        </mark>,
      );
      cursor = c.end;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    if (text.endsWith('\n')) nodes.push('\n');
    return nodes.length ? nodes : text || '\u00a0';
  }, [value, corrections, activeIdx]);

  const openSuggestion = (idx, clientX, clientY) => {
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (!wrap) return;
    setActiveIdx(idx);
    setMenuPos({
      top: Math.min(Math.max(8, clientY - wrap.top + 8), Math.max(8, wrap.height - 12)),
      left: Math.min(Math.max(8, clientX - wrap.left), Math.max(8, wrap.width - 200)),
    });
  };

  const findCorrectionAtCaret = (caret) => {
    for (let i = 0; i < corrections.length; i += 1) {
      const c = corrections[i];
      if (caret >= c.start && caret <= c.end) return i;
    }
    return -1;
  };

  const acceptOne = (idx) => {
    const c = corrections[idx];
    if (!c) return;
    const next = applyCorrectionAt(value, c);
    onChange?.(next);
    lastCheckedRef.current = '';
    setCorrections([]);
    setActiveIdx(null);
    setTimeout(() => void runCheck(next, { force: false }), 400);
  };

  const acceptAll = () => {
    if (!corrections.length) {
      void runCheck(value, { force: true });
      return;
    }
    const next = applyAllGrammarCorrections(value, corrections);
    onChange?.(next);
    lastCheckedRef.current = next;
    setCorrections([]);
    setActiveIdx(null);
    if (toast) toast('Grammar corrected', 'ok');
  };

  const active = activeIdx != null ? corrections[activeIdx] : null;

  return (
    <div className="gram-field" ref={wrapRef}>
      <div className="gram-toolbar" aria-live="polite">
        <span className="gram-status">
          {checking
            ? 'Checking grammar…'
            : corrections.length
              ? `${corrections.length} suggestion${corrections.length === 1 ? '' : 's'} — click underline`
              : value.trim().length >= 8
                ? 'Grammar ready'
                : 'Grammar assist'}
        </span>
        <div className="gram-actions">
          <button
            type="button"
            className="gram-btn"
            disabled={disabled || checking || !String(value || '').trim()}
            onClick={() => void runCheck(value, { force: true })}
            title="Check grammar and spelling"
          >
            Proofread
          </button>
          <button
            type="button"
            className="gram-btn gram-btn-primary"
            disabled={disabled || checking || !corrections.length}
            onClick={acceptAll}
            title="Apply all grammar and spelling suggestions"
          >
            Fix all
          </button>
        </div>
      </div>
      <div className={`gram-editor${corrections.length ? ' gram-editor-has-marks' : ''}`}>
        <div ref={backdropRef} className={`gram-backdrop ${className}`} aria-hidden>
          {highlightNodes}
        </div>
        <textarea
          ref={taRef}
          className={`gram-textarea ${className}`}
          rows={rows}
          value={value}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          spellCheck
          onScroll={syncScroll}
          onClick={(e) => {
            if (!corrections.length) {
              setActiveIdx(null);
              return;
            }
            const caret = e.currentTarget.selectionStart ?? 0;
            const idx = findCorrectionAtCaret(caret);
            if (idx >= 0) openSuggestion(idx, e.clientX, e.clientY);
            else setActiveIdx(null);
          }}
          onChange={(e) => {
            setCorrections([]);
            setActiveIdx(null);
            onChange?.(e.target.value);
          }}
        />
      </div>
      {corrections.length ? (
        <div className="gram-chips" role="list" aria-label="Grammar suggestions">
          {corrections.slice(0, 8).map((c, idx) => (
            <button
              key={`chip-${c.start}-${idx}`}
              type="button"
              className={`gram-chip gram-chip-${c.type === 'spelling' ? 'spelling' : 'grammar'}`}
              role="listitem"
              onClick={() => acceptOne(idx)}
              title={c.message || 'Apply suggestion'}
            >
              <span className="gram-chip-was">{c.original}</span>
              <span aria-hidden>→</span>
              <span className="gram-chip-to">{c.suggestion}</span>
            </button>
          ))}
          {corrections.length > 8 ? (
            <span className="gram-chip-more">+{corrections.length - 8} more — use Fix all</span>
          ) : null}
        </div>
      ) : null}
      {active ? (
        <div
          id={menuId}
          className="gram-menu"
          role="dialog"
          aria-label="Grammar suggestion"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <div className="gram-menu-type">{active.type || 'grammar'}</div>
          <div className="gram-menu-msg">{active.message || 'Suggested change'}</div>
          <button type="button" className="gram-menu-accept" onClick={() => acceptOne(activeIdx)}>
            <span className="gram-menu-was">{active.original}</span>
            <span className="gram-menu-arrow">→</span>
            <span className="gram-menu-to">{active.suggestion}</span>
          </button>
          <button type="button" className="gram-menu-dismiss" onClick={() => setActiveIdx(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
