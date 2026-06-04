import React, { useEffect, useMemo, useState } from 'react';
import { AttachmentPicker } from './AttachmentPicker.jsx';
import { NotifyRecipientPicker } from './NotifyRecipientPicker.jsx';
import { validateCommentPayload } from './preconComments.js';
import { uploadAttachments } from './preconMedia.js';
import { loadExtraRecipients, mergeRecipients, saveExtraRecipients } from './preconAutoNotify.js';
import { loadNotifyContext, notifyPreconUpdate } from './preconNotify.js';

/**
 * Comment + attachments; emails sent automatically to dept heads, leadership, assignees + extras.
 */
export function CommentForm({
  projectId,
  taskId,
  taskWho = '',
  departments = [],
  authorName,
  authorEmail,
  projectName,
  phaseName,
  taskName,
  taskAttachmentIds = [],
  initial = {},
  submitLabel = 'Post comment',
  onSaved,
  toast,
  busy: externalBusy,
}) {
  const [text, setText] = useState(initial.text || '');
  const [nextAction, setNextAction] = useState(initial.nextAction || '');
  const [nextActionDate, setNextActionDate] = useState(initial.nextActionDate || '');
  const [staged, setStaged] = useState([]);
  const [extraRecipients, setExtraRecipients] = useState(() => loadExtraRecipients(projectId));
  const [autoRecipients, setAutoRecipients] = useState([]);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const isBusy = busy || externalBusy;

  useEffect(() => {
    let alive = true;
    loadNotifyContext(projectId, phaseName, taskWho)
      .then((data) => {
        if (!alive) return;
        setEmailEnabled(!!data.emailEnabled);
        setAutoRecipients(data.autoRecipients || []);
      })
      .catch(() => {
        if (alive) setAutoRecipients([]);
      });
    return () => {
      alive = false;
    };
  }, [projectId, phaseName, taskWho]);

  useEffect(() => {
    setExtraRecipients(loadExtraRecipients(projectId));
  }, [projectId]);

  const allRecipientsPreview = useMemo(
    () => mergeRecipients(autoRecipients, extraRecipients),
    [autoRecipients, extraRecipients]
  );

  const handleExtraChange = (list) => {
    const extras = mergeRecipients(list.filter((r) => !autoRecipients.some((a) => a.email === r.email)));
    setExtraRecipients(extras);
    saveExtraRecipients(projectId, extras);
  };

  const handleSubmit = async () => {
    const err = validateCommentPayload({ text, nextAction, nextActionDate });
    if (err) {
      toast(err, 'err');
      return;
    }
    if (!authorName?.trim()) {
      toast('Loading login — try again', 'err');
      return;
    }
    for (const s of staged) {
      if (!String(s.label || '').trim()) {
        toast('Enter a name for each attachment', 'err');
        return;
      }
    }

    setBusy(true);
    try {
      let attachments = [];
      if (staged.length) {
        attachments = await uploadAttachments({
          projectId,
          taskId,
          scope: 'comment',
          files: staged.map((s) => s.file),
          labels: staged.map((s) => s.label.trim()),
        });
      }

      const comment = {
        text: text.trim(),
        author: authorName,
        ts: new Date().toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        nextAction: nextAction.trim(),
        nextActionDate: nextActionDate.trim(),
        flag: /issue|block|delay|risk/i.test(text),
        attachments,
        notifyRecipients: [],
      };

      let emailSent = false;
      let emailError = '';
      let notifyRecipients = allRecipientsPreview;

      try {
        const emailRes = await notifyPreconUpdate({
          kind: 'comment',
          projectId,
          phaseName,
          taskWho,
          projectName,
          taskName,
          author: authorName,
          text: comment.text,
          nextAction: comment.nextAction,
          nextActionDate: comment.nextActionDate,
          attachmentIds: attachments.map((a) => a.id),
          taskAttachmentIds,
          extraRecipients,
        });
        emailSent = !!emailRes.ok;
        notifyRecipients = emailRes.recipients || allRecipientsPreview;
        if (!emailRes.ok) emailError = emailRes.error || 'Email failed';
      } catch (e) {
        emailError = e?.message || 'Email failed';
      }

      comment.notifyRecipients = notifyRecipients;
      comment.emailSent = emailSent;
      comment.emailError = emailError;

      await onSaved(comment);

      if (emailEnabled && notifyRecipients.length) {
        if (emailSent) toast(`Saved — emailed ${notifyRecipients.length} automatically`, 'ok');
        else toast(`Saved — email failed: ${emailError || 'check SMTP'}`, 'err');
      } else if (!notifyRecipients.length) {
        toast('Saved — no recipient emails configured in Admin', 'err');
      } else {
        toast('Comment saved', 'ok');
      }

      setText('');
      setNextAction('');
      setNextActionDate('');
      setStaged([]);
    } catch (e) {
      toast(e?.message || 'Save failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cform cform-rich">
      <p className="cform-meta">
        Posting as <strong style={{ color: '#1A304A' }}>{authorName || '…'}</strong>
        {authorEmail ? <span style={{ color: '#96918A' }}> · {authorEmail}</span> : null}
      </p>
      {emailEnabled ? (
        <div className="nrp-auto-banner">
          <strong>✉ Sends automatically</strong> to department heads, leadership, and this activity&apos;s assignees
          {allRecipientsPreview.length ? (
            <span className="nrp-auto-names"> ({allRecipientsPreview.map((r) => r.name).join(', ')})</span>
          ) : (
            <span className="nrp-auto-names"> — add emails in Admin Security</span>
          )}
        </div>
      ) : (
        <div className="nrp-auto-banner nrp-auto-warn">SMTP not configured — comment saves without email</div>
      )}
      <label className="cform-field">
        <span className="cform-lbl">Comment *</span>
        <textarea
          className="cform-textarea"
          rows={3}
          value={text}
          disabled={isBusy}
          placeholder="Progress update, issue, or decision…"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label className="cform-field">
        <span className="cform-lbl">Next action *</span>
        <input
          type="text"
          className="cform-inp"
          value={nextAction}
          disabled={isBusy}
          placeholder="What needs to happen next?"
          autoComplete="off"
          onChange={(e) => setNextAction(e.target.value)}
        />
      </label>
      <label className="cform-field">
        <span className="cform-lbl">Next action date *</span>
        <input
          type="date"
          className="cform-inp cform-inp-date"
          value={nextActionDate}
          disabled={isBusy}
          required
          onChange={(e) => setNextActionDate(e.target.value)}
        />
      </label>
      <AttachmentPicker items={staged} onChange={setStaged} disabled={isBusy} />
      <NotifyRecipientPicker
        projectId={projectId}
        phaseName={phaseName}
        taskWho={taskWho}
        autoRecipients={autoRecipients}
        extraSelected={extraRecipients}
        onExtraChange={handleExtraChange}
        disabled={isBusy}
      />
      <div className="cform-foot">
        <button type="button" className="btp" disabled={isBusy} onClick={handleSubmit}>
          {isBusy ? 'Saving & emailing…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
