import { fetchNotifyRecipients, sendCommentNotification } from './preconMedia.js';
import { loadExtraRecipients, mergeRecipients, saveExtraRecipients } from './preconAutoNotify.js';

/**
 * Send email with server-side auto recipients (dept heads, leadership, task assignees) + extras.
 */
export async function notifyPreconUpdate({
  kind = 'comment',
  projectId,
  phaseName,
  taskWho,
  projectName,
  taskName,
  author,
  text,
  nextAction,
  nextActionDate,
  attachmentIds = [],
  taskAttachmentIds = [],
  extraRecipients = [],
}) {
  const extras = mergeRecipients(extraRecipients, loadExtraRecipients(projectId));
  return sendCommentNotification({
    kind,
    autoNotify: true,
    projectId,
    phaseName,
    taskWho,
    projectName,
    taskName,
    author,
    text,
    nextAction,
    nextActionDate,
    extraRecipients: extras,
    attachmentIds,
    taskAttachmentIds,
  });
}

export async function loadNotifyContext(projectId, phaseName, taskWho) {
  const q = new URLSearchParams();
  if (projectId) q.set('projectId', projectId);
  if (phaseName) q.set('phaseName', phaseName);
  if (taskWho) q.set('taskWho', taskWho);
  const suffix = q.toString() ? `?${q}` : '';
  const res = await fetch(`/api/preconstruction/notify-recipients${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Recipients failed (${res.status})`);
  return data;
}

export { saveExtraRecipients, loadExtraRecipients, mergeRecipients };
