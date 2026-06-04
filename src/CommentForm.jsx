import React, { useState } from 'react';
import { AttachmentPicker } from './AttachmentPicker.jsx';
import { NotifyRecipientPicker } from './NotifyRecipientPicker.jsx';
import { validateCommentPayload } from './preconComments.js';
import { sendCommentNotification, uploadAttachments } from './preconMedia.js';

/**
 * Comment + attachments + email recipients (shared: Tasks tab & My Work).
 */
export function CommentForm({
  projectId,
  taskId,
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
  const [recipients, setRecipients] = useState([]);
  const [busy, setBusy] = useState(false);

  const isBusy = busy || externalBusy;

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
        notifyRecipients: recipients,
      };

      let emailSent = false;
      let emailError = '';
      if (recipients.length) {
        try {
          const emailRes = await sendCommentNotification({
            projectName,
            phaseName,
            taskName,
            author: authorName,
            text: comment.text,
            nextAction: comment.nextAction,
            nextActionDate: comment.nextActionDate,
            recipients,
            attachmentIds: attachments.map((a) => a.id),
            taskAttachmentIds,
          });
          emailSent = !!emailRes.ok;
          if (!emailRes.ok) emailError = emailRes.error || 'Email failed';
        } catch (e) {
          emailError = e?.message || 'Email failed';
        }
      }

      comment.emailSent = emailSent;
      comment.emailError = emailError;

      await onSaved(comment);

      if (recipients.length) {
        if (emailSent) toast(`Saved and emailed ${recipients.length} recipient(s)`, 'ok');
        else toast(`Saved — email failed: ${emailError || 'check SMTP'}`, 'err');
      } else {
        toast('Comment saved', 'ok');
      }

      setText('');
      setNextAction('');
      setNextActionDate('');
      setStaged([]);
      setRecipients([]);
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
        selected={recipients}
        onChange={setRecipients}
        disabled={isBusy}
      />
      <div className="cform-foot">
        <button type="button" className="btp" disabled={isBusy} onClick={handleSubmit}>
          {isBusy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
