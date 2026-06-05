import React, { useEffect, useMemo, useState } from 'react';
import { AttachmentPicker } from './AttachmentPicker.jsx';
import { NotifyRecipientPicker } from './NotifyRecipientPicker.jsx';
import { validateCommentPayload } from './preconComments.js';
import { uploadAttachments } from './preconMedia.js';
import { loadExtraRecipients, mergeRecipients, saveExtraRecipients } from './preconAutoNotify.js';
import { loadNotifyContext, notifyPreconUpdate } from './preconNotify.js';

/**
 * Comment + attachments; saves text immediately, uploads files and sends notify in background.
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
  onNotifyComplete,
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
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const isBusy = busy || externalBusy;

  useEffect(() => {
    let alive = true;
    loadNotifyContext(projectId, phaseName, taskWho)
      .then((data) => {
        if (!alive) return;
        setEmailEnabled(!!data.emailEnabled);
        setWhatsappEnabled(!!data.whatsappEnabled);
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

  const runPostSaveWork = (commentIndex, stagedCopy, saved, notifyRecipients) => {
    void (async () => {
      let attachments = [];
      try {
        if (stagedCopy.length) {
          attachments = await uploadAttachments({
            projectId,
            taskId,
            scope: 'comment',
            files: stagedCopy.map((s) => s.file),
            labels: stagedCopy.map((s) => s.label),
          });
          if (commentIndex != null && onNotifyComplete) {
            onNotifyComplete({ attachments, attachmentsPending: false }, commentIndex);
          }
        }
      } catch (e) {
        if (commentIndex != null && onNotifyComplete) {
          onNotifyComplete({ attachmentsPending: false, attachmentError: e?.message || 'Upload failed' }, commentIndex);
        }
        toast(`Attachment upload failed: ${e?.message || 'Upload failed'}`, 'err');
      }

      const shouldNotify = (emailEnabled || whatsappEnabled) && notifyRecipients.length > 0;
      if (!shouldNotify) {
        if (!notifyRecipients.length && (emailEnabled || whatsappEnabled)) {
          if (commentIndex != null && onNotifyComplete) {
            onNotifyComplete({ notifyPending: false, emailError: 'No recipients' }, commentIndex);
          }
        } else if (commentIndex != null && onNotifyComplete) {
          onNotifyComplete({ notifyPending: false }, commentIndex);
        }
        return;
      }

      try {
        const emailRes = await notifyPreconUpdate({
          kind: 'comment',
          projectId,
          phaseName,
          taskWho,
          projectName,
          taskName,
          author: authorName,
          text: saved.text,
          nextAction: saved.nextAction,
          nextActionDate: saved.nextActionDate,
          attachmentIds: attachments.map((a) => a.id),
          taskAttachmentIds,
          extraRecipients,
        });

        const patch = {
          emailSent: !!emailRes.ok,
          emailError: emailRes.ok ? '' : emailRes.error || 'Email failed',
          notifyRecipients: emailRes.recipients || notifyRecipients,
          notifyPending: false,
        };
        if (commentIndex != null && onNotifyComplete) onNotifyComplete(patch, commentIndex);

        const waOk = emailRes?.whatsapp?.ok;
        const waCount = emailRes?.whatsappCount || 0;
        const parts = [];
        if (patch.emailSent) parts.push(`email ${patch.notifyRecipients.length}`);
        if (waOk && waCount) parts.push(`WhatsApp ${waCount}`);
        if (parts.length) toast(`Notifications sent (${parts.join(', ')})`, 'ok');
        else toast(`Notifications failed: ${patch.emailError || emailRes?.whatsapp?.error || 'check SMTP/Twilio'}`, 'err');
      } catch (e) {
        const patch = {
          emailSent: false,
          emailError: e?.message || 'Notify failed',
          notifyPending: false,
        };
        if (commentIndex != null && onNotifyComplete) onNotifyComplete(patch, commentIndex);
        toast(`Notifications failed: ${patch.emailError}`, 'err');
      }
    })();
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

    const savedText = text.trim();
    const savedNextAction = nextAction.trim();
    const savedNextActionDate = nextActionDate.trim();
    const stagedCopy = staged.map((s) => ({ file: s.file, label: s.label.trim() }));
    const notifyRecipients = allRecipientsPreview;
    const shouldNotifyLater = (emailEnabled || whatsappEnabled) && notifyRecipients.length > 0;

    setBusy(true);
    try {
      const comment = {
        text: savedText,
        author: authorName,
        ts: new Date().toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        nextAction: savedNextAction,
        nextActionDate: savedNextActionDate,
        flag: /issue|block|delay|risk/i.test(savedText),
        attachments: [],
        attachmentsPending: stagedCopy.length > 0,
        notifyRecipients,
        notifyPending: shouldNotifyLater,
        emailSent: false,
        emailError: '',
      };

      const commentIndex = await Promise.resolve(onSaved(comment));

      toast(stagedCopy.length ? 'Comment saved — uploading files…' : 'Comment saved', 'ok');
      setText('');
      setNextAction('');
      setNextActionDate('');
      setStaged([]);

      runPostSaveWork(
        commentIndex,
        stagedCopy,
        { text: savedText, nextAction: savedNextAction, nextActionDate: savedNextActionDate },
        notifyRecipients
      );

      if (!shouldNotifyLater && !notifyRecipients.length && (emailEnabled || whatsappEnabled)) {
        toast('Add emails/phones in Admin Security for notifications', 'err');
      }
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
      {emailEnabled || whatsappEnabled ? (
        <div className="nrp-auto-banner">
          <strong>✉ Sends automatically</strong> to department heads, leadership, and assignees
          {emailEnabled ? <span className="nrp-auto-names"> · email</span> : null}
          {whatsappEnabled ? <span className="nrp-auto-names"> · WhatsApp (phones in Admin)</span> : null}
          {allRecipientsPreview.length ? (
            <span className="nrp-auto-names"> ({allRecipientsPreview.map((r) => r.name).join(', ')})</span>
          ) : (
            <span className="nrp-auto-names"> — add email &amp; WhatsApp phone per user in Admin</span>
          )}
        </div>
      ) : (
        <div className="nrp-auto-banner nrp-auto-warn">Email/WhatsApp not configured on server — comment saves locally only</div>
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
          {isBusy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
