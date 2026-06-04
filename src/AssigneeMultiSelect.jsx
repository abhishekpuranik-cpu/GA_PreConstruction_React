import React, { useEffect, useRef, useState } from 'react';
import { formatAssignees, parseAssignees } from './preconAssignees.js';

/**
 * Multi-select assignee picker (chips + dropdown checklist).
 * @param {string} value — stored task.who ("Name1; Name2")
 */
export function AssigneeMultiSelect({ value, options, onChange, disabled, compact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = parseAssignees(value);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = (name) => {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange(formatAssignees([...set]));
  };

  return (
    <div className={`ams${compact ? ' ams-compact' : ''}`} ref={ref}>
      <button
        type="button"
        className="ams-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Select assignees"
      >
        {selected.length ? (
          <span className="ams-chips-inline">
            {selected.slice(0, compact ? 1 : 2).map((n) => (
              <span key={n} className="ams-chip">
                {n}
              </span>
            ))}
            {selected.length > (compact ? 1 : 2) ? (
              <span className="ams-more">+{selected.length - (compact ? 1 : 2)}</span>
            ) : null}
          </span>
        ) : (
          <span className="ams-placeholder">Assign…</span>
        )}
        <span className="ams-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div className="ams-menu" role="listbox">
          <div className="ams-menu-hint">Select one or more people</div>
          {options.length ? (
            options.map((name) => {
              const on = selected.includes(name);
              return (
                <label key={name} className={`ams-opt${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                  <span>{name}</span>
                </label>
              );
            })
          ) : (
            <div className="ams-empty">No assignees on your projects yet</div>
          )}
          {selected.length ? (
            <button type="button" className="ams-clear" onClick={() => onChange('')}>
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
