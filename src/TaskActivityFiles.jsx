import React, { useState } from 'react';
import { AttachmentLinks, AttachmentPicker } from './AttachmentPicker.jsx';
import { uploadAttachments } from './preconMedia.js';
import { loadExtraRecipients } from './preconAutoNotify.js';
import { notifyPreconUpdate } from './preconNotify.js';

/**
 * Files linked to the activity (task); notifies leadership & dept heads in background after upload.
 */
export function TaskActivityFiles({
  proj,
  ph,
  task,
  dispatch,
  toast,
  authorName,
}) {
  const [staged, setStaged] = useState([]);
  const [busy, setBusy] = useState(false);
  const attachments = task.attachments || [];

  const upload = async () => {
    if (!staged.length) {
      toast('Add at least one file', 'err');
      return;
    }
    for (const s of staged) {
      if (!String(s.label || '').trim()) {
        toast('Enter a document name for each file', 'err');
        return;
      }
    }
    setBusy(true);
    try {
      const uploaded = await uploadAttachments({
        projectId: proj.id,
        taskId: task.id,
        scope: 'task',
        files: staged.map((s) => s.file),
        labels: staged.map((s) => s.label.trim()),
      });
      dispatch({
        type: 'addTaskAttachments',
        projId: proj.id,
        tId: task.id,
        attachments: uploaded,
      });
      setStaged([]);
      toast('Files uploaded', 'ok');

      const labels = uploaded.map((a) => a.label || a.fileName);
      void (async () => {
        try {
          const emailRes = await notifyPreconUpdate({
            kind: 'activity',
            projectId: proj.id,
            phaseName: ph?.name || '',
            taskWho: task.who || '',
            projectName: proj.name,
            taskName: task.name,
            author: authorName || 'Team',
            text: `New file(s): ${labels.join(', ')}`,
            nextAction: 'Review uploaded activity files',
            nextActionDate: '',
            attachmentIds: uploaded.map((a) => a.id),
            taskAttachmentIds: [],
            extraRecipients: loadExtraRecipients(proj.id),
          });
          const wa = emailRes.whatsappCount || 0;
          if (emailRes.ok || emailRes.whatsapp?.ok) {
            const parts = [];
            if (emailRes.ok) parts.push(`email ${emailRes.recipientCount || 0}`);
            if (emailRes.whatsapp?.ok && wa) parts.push(`WhatsApp ${wa}`);
            toast(`Notifications sent (${parts.join(', ') || 'ok'})`, 'ok');
          } else {
            toast(`Notifications failed: ${emailRes.error || emailRes.whatsapp?.error || 'check SMTP/Twilio'}`, 'err');
          }
        } catch (e) {
          toast(`Notifications failed: ${e?.message || ''}`, 'err');
        }
      })();
    } catch (e) {
      toast(e?.message || 'Upload failed', 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-files">
      <div className="task-files-head">
        <span className="task-files-title">Activity files</span>
        <span className="task-files-sub">Uploads email dept heads, leadership & assignees automatically</span>
      </div>
      {attachments.length ? <AttachmentLinks attachments={attachments} /> : null}
      <AttachmentPicker items={staged} onChange={setStaged} disabled={busy} compact />
      {staged.length ? (
        <button type="button" className="btg" disabled={busy} onClick={upload}>
          {busy ? 'Uploading…' : 'Upload to activity'}
        </button>
      ) : null}
    </div>
  );
}
