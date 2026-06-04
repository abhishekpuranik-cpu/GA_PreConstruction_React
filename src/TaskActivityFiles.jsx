import React, { useState } from 'react';
import { AttachmentLinks, AttachmentPicker } from './AttachmentPicker.jsx';
import { uploadAttachments } from './preconMedia.js';

/**
 * Files linked to the activity (task), not tied to a single comment.
 */
export function TaskActivityFiles({ proj, task, dispatch, toast }) {
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
      toast('Activity files saved', 'ok');
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
        <span className="task-files-sub">Photos, videos & documents for this task</span>
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
