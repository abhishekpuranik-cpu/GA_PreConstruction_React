import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatAssignees, parseAssignees } from './preconAssignees.js';

/**
 * Multi-select assignee picker (chips + dropdown checklist).
 * Menu is portaled + fixed so table overflow does not clip it.
 * Options should include project-tagged people and Security Admin users.
 * @param {string} value — stored task.who ("Name1; Name2")
 */
export function AssigneeMultiSelect({ value, options, onChange, disabled, compact }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 220 });
  const [filter, setFilter] = useState('');
  const ref = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const filterRef = useRef(null);
  const selected = parseAssignees(value);
  const displayOptions = useMemo(() => {
    const set = new Set(options || []);
    selected.forEach((n) => set.add(n));
    const all = [...set].sort((a, b) => a.localeCompare(b));
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return all;
    return all.filter((n) => String(n).toLowerCase().includes(q));
  }, [options, selected, filter]);

  const updateMenuPos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, compact ? 220 : 260);
    let left = r.left;
    const maxLeft = window.innerWidth - width - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    const below = r.bottom + 4;
    const menuH = Math.min(320, window.innerHeight * 0.55);
    const top = below + menuH > window.innerHeight - 8
      ? Math.max(8, r.top - menuH - 4)
      : below;
    setMenuPos({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPos();
    const t = setTimeout(() => filterRef.current?.focus?.(), 0);
    return () => clearTimeout(t);
  }, [open, compact]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const t = e.target;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setFilter('');
    };
    const onReposition = () => updateMenuPos();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  const toggle = (name) => {
    const set = new Set(selected);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange(formatAssignees([...set]));
  };

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="ams-menu ams-menu-portal"
          role="listbox"
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            zIndex: 1200,
          }}
        >
          <div className="ams-menu-hint">Project team or Security Admin users</div>
          <div className="ams-filter">
            <input
              ref={filterRef}
              type="search"
              className="ams-filter-inp"
              value={filter}
              placeholder="Search people…"
              autoComplete="off"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          {displayOptions.length ? (
            displayOptions.map((name) => {
              const on = selected.includes(name);
              return (
                <label key={name} className={`ams-opt${on ? ' on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(name)} />
                  <span>{name}</span>
                </label>
              );
            })
          ) : (
            <div className="ams-empty">{filter ? 'No matching assignee' : 'No assignees available'}</div>
          )}
          {selected.length ? (
            <button type="button" className="ams-clear" onClick={() => onChange('')}>
              Clear all
            </button>
          ) : null}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`ams${compact ? ' ams-compact' : ''}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        className="ams-trigger"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          if (open) setFilter('');
        }}
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
      {menu}
    </div>
  );
}
