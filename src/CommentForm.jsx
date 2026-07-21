import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AttachmentPicker } from './AttachmentPicker.jsx';
import { SpeechDictationButton } from './SpeechDictationButton.jsx';
import { validateCommentPayload } from './preconComments.js';
import { uploadAttachments } from './preconMedia.js';
import { loadExtraRecipients, mergeRecipients, saveExtraRecipients } from './preconAutoNotify.js';
import { loadNotifyContext, notifyPreconUpdate, hasNotifyTargets, runPreconNotification } from './preconNotify.js';
import { joinTranscript, useSpeechDictation } from './useSpeechDictation.js';

/**
 * Comment + attachments; saves text immediately, uploads files and sends notify in background.
 * Task assignee is edited on the project Tasks row / comment modal header (not in this form).
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
  hideNotifyBanner = false,
  compact = false,
  /** Show “mark activity complete” when the task is still open. */
  allowMarkComplete = true,
  /** Called after comment save when the user checked mark-complete. */
  onMarkComplete,
}) {
  const [text, setText] = useState(initial.text || '');
  const [nextAction, setNextAction] = useState(initial.nextAction || '');
  const [nextActionDate, setNextActionDate] = useState(initial.nextActionDate || '');
  const [staged, setStaged] = useState([]);
  const [extraRecipients, setExtraRecipients] = useState(() => loadExtraRecipients(projectId));
  const [autoRecipients, setAutoRecipients] = useState([]);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [emailConfig, setEmailConfig] = useState(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [markComplete, setMarkComplete] = useState(false);
  const isBusy = busy || externalBusy;
  const assignee = taskWho || '';

  const onSpeechFinal = useCallback((fieldId, chunk) => {
    if (fieldId === 'comment') {
      setText((prev) => joinTranscript(prev, chunk));
      return;
    }
    if (fieldId === 'nextAction') {
      setNextAction((prev) => joinTranscript(prev, chunk));
    }
  }, []);

  const speech = useSpeechDictation({
    onFinal: onSpeechFinal,
    lang: 'en-IN',
    disabled: isBusy,
  });

  useEffect(() => {
    if (!speech.error || !toast) return;
    toast(speech.error, 'err');
    speech.clearError();
  }, [speech.error, toast, speech.clearError]);
  useEffect(() => {
    let alive = true;
    loadNotifyContext(projectId, phaseName, taskWho)
      .then((data) => {
        if (!alive) return;
        setEmailEnabled(!!data.emailEnabled);
        setEmailConfig(data.emailConfig || null);
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
      const shouldNotify = hasNotifyTargets(notifyRecipients, { emailEnabled, whatsappEnabled });
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
          taskWho: assignee,
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
        if (emailRes.queued && emailRes.jobId) {
          if (commentIndex != null && onNotifyComplete) {
            onNotifyComplete(
              {
                emailQueued: true,
                emailSent: false,
                emailError: '',
                whatsappSent: false,
                whatsappError: '',
                notifyRecipients: emailRes.recipients || notifyRecipients,
                notifyPending: true,
              },
              commentIndex
            );
          }
          const { patch } = await runPreconNotification(emailRes, toast);
          if (commentIndex != null && onNotifyComplete && patch) onNotifyComplete(patch, commentIndex);
        } else {
          const patch = {
            emailSent: !!emailRes.ok,
            emailError: emailRes.ok ? '' : emailRes.error || 'Email failed',
            whatsappSent: !!(emailRes?.whatsapp?.ok && (emailRes.whatsappCount || emailRes?.whatsapp?.sent?.length)),
            whatsappError: emailRes?.whatsapp?.error || '',
            notifyRecipients: emailRes.recipients || notifyRecipients,
            notifyPending: false,
          };
          if (commentIndex != null && onNotifyComplete) onNotifyComplete(patch, commentIndex);
          if (!patch.emailSent && !patch.whatsappSent) {
            await runPreconNotification(emailRes, toast);
          }
        }
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
    let commentText = text;
    let actionText = nextAction;
    if (speech.listening && speech.interim) {
      if (speech.activeField === 'comment') commentText = joinTranscript(text, speech.interim);
      if (speech.activeField === 'nextAction') actionText = joinTranscript(nextAction, speech.interim);
    }
    speech.stop();
    if (commentText !== text) setText(commentText);
    if (actionText !== nextAction) setNextAction(actionText);

    const err = validateCommentPayload({ text: commentText, nextAction: actionText, nextActionDate, markComplete });
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
    const savedText = commentText.trim();
    // When marking complete, next action fields are not required and not stored.
    const savedNextAction = markComplete ? '' : actionText.trim();
    const savedNextActionDate = markComplete ? '' : nextActionDate.trim();
    const stagedCopy = staged.map((s) => ({ file: s.file, label: s.label.trim() }));
    const notifyRecipients = allRecipientsPreview;
    const shouldNotifyLater = hasNotifyTargets(notifyRecipients, { emailEnabled, whatsappEnabled });
    const shouldMarkComplete = !!(markComplete && allowMarkComplete && typeof onMarkComplete === 'function');
    setBusy(true);
    try {
      const now = new Date();
      const comment = {
        id: `c_${now.getTime()}_${Math.random().toString(36).slice(2, 9)}`,
        text: savedText,
        author: authorName,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        ts: now.toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        nextAction: savedNextAction,
        nextActionDate: savedNextActionDate,
        flag: /issue|block|delay|risk/i.test(savedText),
        markedComplete: shouldMarkComplete,
        attachments: [],
        attachmentsPending: stagedCopy.length > 0,
        notifyRecipients,
        notifyPending: shouldNotifyLater,
        emailSent: false,
        emailError: '',
        taskWho: assignee,
      };
      const commentIndex = await Promise.resolve(onSaved?.(comment));
      if (shouldMarkComplete) {
        try {
          onMarkComplete(comment);
        } catch (e) {
          toast(e?.message || 'Could not mark activity complete', 'err');
        }
      }
      toast(
        shouldMarkComplete
          ? (stagedCopy.length
            ? 'Comment saved & activity marked complete — uploading files… Syncing to team…'
            : 'Comment saved & activity marked complete — syncing to team…')
          : (stagedCopy.length
            ? 'Comment saved — uploading files… Syncing to team…'
            : 'Comment saved — syncing to team…'),
        'ok',
      );
      setText('');
      setNextAction('');
      setNextActionDate('');
      setMarkComplete(false);
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
  const canSubmit = markComplete
    ? !!String(text || '').trim()
    : !!(
        String(text || '').trim() &&
        String(nextAction || '').trim() &&
        String(nextActionDate || '').trim()
      );
  return (
    <div className={`cform cform-rich${compact ? ' cform-compact' : ''}`}>
      {(projectName || phaseName) ? (
        <div className="cform-context" aria-label="Task context">
          {projectName ? <div className="cform-context-proj">{projectName}</div> : null}
          {phaseName ? <div className="cform-context-phase">{phaseName}</div> : null}
        </div>
      ) : null}
      <p className="cform-meta">
        Posting as <strong style={{ color: '#1A304A' }}>{authorName || '…'}</strong>
        {authorEmail ? <span style={{ color: '#96918A' }}> · {authorEmail}</span> : null}
      </p>
      {!hideNotifyBanner && emailConfig?.setupRequired && !emailEnabled ? (
        <div className="nrp-auto-banner nrp-auto-warn">
          <strong>Email notifications need setup on Render</strong> — set{' '}
          <code>EMAIL_PROVIDER=resend</code> + <code>RESEND_API_KEY</code>, or use the Google Apps Script relay (
          <code>EMAIL_PROVIDER=gas</code>). Comments still save locally.
        </div>
      ) : null}
      {!hideNotifyBanner && emailEnabled && autoRecipients.length > 0 && !autoRecipients.some((r) => String(r.email || '').includes('@')) ? (
        <p className="nrp-warn" style={{ marginTop: 6, fontSize: 11 }}>
          Email is on but <strong>no auto-recipients have an address</strong> in Admin Security — add work emails for assignees.
        </p>
      ) : null}
      {!hideNotifyBanner && (emailEnabled || whatsappEnabled) ? (
        <div className="nrp-auto-banner">
          <strong>✉ Sends automatically</strong> to dept heads, leadership &amp; assignees on this project
          {emailEnabled ? (
            <span className="nrp-auto-names">
              {' '}
              · email{emailConfig?.provider ? ` (${emailConfig.provider})` : ''} — PreConstruction app + project access only
            </span>
          ) : null}
          {whatsappEnabled ? <span className="nrp-auto-names"> · WhatsApp (optional)</span> : null}
          {allRecipientsPreview.length ? (
            <span className="nrp-auto-names"> ({allRecipientsPreview.map((r) => r.name).join(', ')})</span>
          ) : (
            <span className="nrp-auto-names"> — add work email per user in Admin Security</span>
          )}
        </div>
      ) : !hideNotifyBanner && !emailConfig?.setupRequired ? (
        <div className="nrp-auto-banner nrp-auto-warn">Notifications not configured on server — comment saves locally only</div>
      ) : null}
      <div className="cform-field">
        <div className="cform-lbl-row">
          <span className="cform-lbl">Comment *</span>
          <SpeechDictationButton
            fieldId="comment"
            activeField={speech.activeField}
            listening={speech.listening}
            supported={speech.supported}
            disabled={isBusy}
            onToggle={speech.toggle}
          />
        </div>
        <textarea
          className="cform-textarea"
          rows={3}
          value={
            speech.listening && speech.activeField === 'comment' && speech.interim
              ? joinTranscript(text, speech.interim)
              : text
          }
          disabled={isBusy}
          required
          placeholder="Progress update, issue, or decision… (or tap Voice)"
          onChange={(e) => {
            if (speech.listening && speech.activeField === 'comment') speech.stop();
            setText(e.target.value);
          }}
        />
        {speech.listening && speech.activeField === 'comment' ? (
          <p className="cform-mic-hint">Listening — speak clearly. Tap ⏹ to stop.</p>
        ) : null}
      </div>
      {allowMarkComplete ? (
        <label className="cform-complete">
          <input
            type="checkbox"
            checked={markComplete}
            disabled={isBusy}
            onChange={(e) => {
              const on = e.target.checked;
              setMarkComplete(on);
              if (on && speech.listening && speech.activeField === 'nextAction') speech.stop();
            }}
          />
          <span>
            <strong>Mark this activity as complete</strong>
            <span className="cform-complete-hint">Comment only — next action not required</span>
          </span>
        </label>
      ) : null}
      {!markComplete ? (
        <>
          <div className="cform-field">
            <div className="cform-lbl-row">
              <span className="cform-lbl">Next action *</span>
              <SpeechDictationButton
                fieldId="nextAction"
                activeField={speech.activeField}
                listening={speech.listening}
                supported={speech.supported}
                disabled={isBusy}
                onToggle={speech.toggle}
              />
            </div>
            <input
              type="text"
              className="cform-inp"
              value={
                speech.listening && speech.activeField === 'nextAction' && speech.interim
                  ? joinTranscript(nextAction, speech.interim)
                  : nextAction
              }
              disabled={isBusy}
              required
              placeholder="What needs to happen next? (or tap Voice)"
              autoComplete="off"
              onChange={(e) => {
                if (speech.listening && speech.activeField === 'nextAction') speech.stop();
                setNextAction(e.target.value);
              }}
            />
            {speech.listening && speech.activeField === 'nextAction' ? (
              <p className="cform-mic-hint">Listening — speak the next action. Tap ⏹ to stop.</p>
            ) : null}
          </div>
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
        </>
      ) : (
        <p className="cform-complete-done" style={{ marginTop: 0 }}>
          Next action is skipped because this activity is being marked complete.
        </p>
      )}
      <AttachmentPicker items={staged} onChange={setStaged} disabled={isBusy} />
      <div className="cform-foot">
        <button type="button" className="btp" disabled={isBusy || !canSubmit} onClick={handleSubmit}>
          {isBusy ? 'Saving…' : (markComplete ? 'Save & complete' : submitLabel)}
        </button>
      </div>
    </div>
  );
}
