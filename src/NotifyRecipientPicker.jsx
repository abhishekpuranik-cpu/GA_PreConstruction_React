import React, { useEffect, useMemo, useState } from 'react';
import { fetchNotifyRecipients } from './preconMedia.js';

function emailKey(r) {
  return String(r.email || '').toLowerCase();
}

/**
 * @param {{ projectId: string, selected: {name,email}[], onChange: (list) => void, disabled?: boolean }} props
 */
export function NotifyRecipientPicker({ projectId, selected, onChange, disabled }) {
  const [loading, setLoading] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [groups, setGroups] = useState({ departmentHeads: [], assignees: [], team: [] });
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    fetchNotifyRecipients(projectId)
      .then((data) => {
        if (!alive) return;
        setEmailEnabled(!!data.emailEnabled);
        setGroups(data.groups || { departmentHeads: [], assignees: [], team: [] });
      })
      .catch((e) => {
        if (alive) setErr(e?.message || 'Could not load recipients');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const selectedSet = useMemo(() => new Set((selected || []).map(emailKey)), [selected]);

  const toggle = (r) => {
    const k = emailKey(r);
    if (!k) return;
    const set = new Set((selected || []).map(emailKey));
    if (set.has(k)) set.delete(k);
    else set.add(k);
    const all = [...groups.departmentHeads, ...groups.assignees, ...groups.team];
    const next = all.filter((x) => set.has(emailKey(x)));
    onChange(next);
  };

  const selectGroup = (list) => {
    const withEmail = (list || []).filter((r) => r.email);
    const set = new Set((selected || []).map(emailKey));
    withEmail.forEach((r) => set.add(emailKey(r)));
    const all = [...groups.departmentHeads, ...groups.assignees, ...groups.team];
    onChange(all.filter((x) => set.has(emailKey(x))));
  };

  const clearAll = () => onChange([]);

  const renderGroup = (title, list, hint) => {
    const rows = list || [];
    if (!rows.length) return null;
    return (
      <div className="nrp-group">
        <div className="nrp-group-head">
          <span className="nrp-group-title">{title}</span>
          {hint ? <span className="nrp-group-hint">{hint}</span> : null}
          <button type="button" className="nrp-link" disabled={disabled} onClick={() => selectGroup(rows)}>
            Select all
          </button>
        </div>
        <div className="nrp-chips">
          {rows.map((r) => {
            const k = emailKey(r);
            const on = k && selectedSet.has(k);
            const noEmail = !r.email;
            return (
              <label key={`${title}-${r.name}`} className={`nrp-chip${on ? ' on' : ''}${noEmail ? ' dim' : ''}`}>
                <input
                  type="checkbox"
                  disabled={disabled || noEmail}
                  checked={!!on}
                  onChange={() => toggle(r)}
                />
                <span className="nrp-chip-name">{r.name}</span>
                {noEmail ? <span className="nrp-no-email">No email in Admin</span> : null}
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  if (loading) return <p className="nrp-loading">Loading notification list…</p>;
  if (err) return <p className="nrp-err">{err}</p>;

  return (
    <div className="nrp">
      <div className="nrp-head">
        <span className="nrp-title">Email this update to</span>
        {!emailEnabled ? (
          <span className="nrp-warn">SMTP not configured on server — comment will save without email</span>
        ) : (
          <span className="nrp-ok">Attachments included when selected</span>
        )}
        {selected?.length ? (
          <button type="button" className="nrp-link" disabled={disabled} onClick={clearAll}>
            Clear ({selected.length})
          </button>
        ) : null}
      </div>
      {renderGroup('Department heads', groups.departmentHeads, 'Leads per phase')}
      {renderGroup('Assignees on project', groups.assignees, 'From tasks on this project')}
      {renderGroup('PreConstruction team', groups.team, 'Users with vault access')}
      {!groups.departmentHeads?.length && !groups.assignees?.length && !groups.team?.length ? (
        <p className="nrp-empty">Add department heads or assignees to enable notifications.</p>
      ) : null}
    </div>
  );
}
