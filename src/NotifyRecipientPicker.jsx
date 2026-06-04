import React, { useEffect, useMemo, useState } from 'react';
import { fetchNotifyRecipients } from './preconMedia.js';
import { mergeRecipients } from './preconAutoNotify.js';

function emailKey(r) {
  return String(r.email || '').toLowerCase();
}

/**
 * Extra recipients (saved per project) — auto list is always included on send.
 */
export function NotifyRecipientPicker({
  projectId,
  phaseName,
  taskWho,
  autoRecipients = [],
  extraSelected = [],
  onExtraChange,
  disabled,
}) {
  const [loading, setLoading] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [groups, setGroups] = useState({ departmentHeads: [], leadership: [], assignees: [], team: [] });
  const [err, setErr] = useState('');

  const autoSet = useMemo(() => new Set((autoRecipients || []).map(emailKey)), [autoRecipients]);
  const extraSet = useMemo(() => new Set((extraSelected || []).map(emailKey)), [extraSelected]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr('');
    fetchNotifyRecipients(projectId, { phaseName, taskWho })
      .then((data) => {
        if (!alive) return;
        setEmailEnabled(!!data.emailEnabled);
        setGroups(data.groups || { departmentHeads: [], leadership: [], assignees: [], team: [] });
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
  }, [projectId, phaseName, taskWho]);

  const optionalPool = useMemo(() => {
    const all = [
      ...(groups.team || []),
      ...(groups.assignees || []),
      ...(groups.departmentHeads || []),
      ...(groups.leadership || []),
    ];
    return mergeRecipients(all).filter((r) => r.email && !autoSet.has(emailKey(r)));
  }, [groups, autoSet]);

  const toggleExtra = (r) => {
    const k = emailKey(r);
    if (!k || autoSet.has(k)) return;
    const set = new Set((extraSelected || []).map(emailKey));
    if (set.has(k)) set.delete(k);
    else set.add(k);
    const next = optionalPool.filter((x) => set.has(emailKey(x)));
    onExtraChange(next);
  };

  if (loading) return <p className="nrp-loading">Loading people list…</p>;
  if (err) return <p className="nrp-err">{err}</p>;

  return (
    <div className="nrp nrp-extras">
      <div className="nrp-head">
        <span className="nrp-title">Also notify (optional)</span>
        <span className="nrp-group-hint">Saved for this project · auto list above always included</span>
      </div>
      {optionalPool.length ? (
        <div className="nrp-chips">
          {optionalPool.map((r) => {
            const on = extraSet.has(emailKey(r));
            return (
              <label key={r.email} className={`nrp-chip${on ? ' on' : ''}`}>
                <input type="checkbox" disabled={disabled} checked={on} onChange={() => toggleExtra(r)} />
                <span className="nrp-chip-name">{r.name}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <p className="nrp-empty">Everyone with email is already in the automatic list.</p>
      )}
      {!emailEnabled ? (
        <p className="nrp-warn" style={{ marginTop: 8 }}>
          Configure SMTP on the server to enable automatic email.
        </p>
      ) : null}
    </div>
  );
}
