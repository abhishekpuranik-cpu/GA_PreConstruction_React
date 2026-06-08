import React from 'react';
import { STATUS_FILTER_OPTIONS } from './preconTaskStatus.js';

export function StatusFilterChips({ value, onChange }) {
  const selected = value || [];
  const toggle = (v) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <span className="st-filter">
      {STATUS_FILTER_OPTIONS.map((o) => (
        <span key={o.value} className={`st-chip${selected.includes(o.value) ? ' on' : ''}`}>
          <label>
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        </span>
      ))}
      {selected.length ? (
        <button type="button" className="st-chip-clear" onClick={() => onChange([])}>
          Clear
        </button>
      ) : null}
    </span>
  );
}
