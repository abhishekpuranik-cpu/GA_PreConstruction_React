import { fetchNotifyRecipients, sendCommentNotification, pollNotifyJob, notifyResultFromPoll, formatUserNotifyError } from './preconMedia.js';
import { loadExtraRecipients, mergeRecipients, saveExtraRecipients } from './preconAutoNotify.js';

const statusNotifyLock = new Map();
export function phoneDigits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

export function recipientHasPhone(r) {
  return phoneDigits(r?.phone).length >= 10;
}

export function recipientHasEmail(r) {
  return Boolean(String(r?.email || '').includes('@'));
}

/** True when we should queue a server notify job (server enriches phones from Admin Security). */
export function hasNotifyTargets(recipients, { emailEnabled, whatsappEnabled }) {
  const list = recipients || [];
  if (!list.length || (!emailEnabled && !whatsappEnabled)) return false;
  if (emailEnabled && list.some(recipientHasEmail)) return true;
  if (whatsappEnabled && list.some(recipientHasPhone)) return true;
  // Recipients exist but phones may only resolve server-side — still attempt send.
  return true;
}

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

export async function runPreconNotification(emailRes, toast) {
  if (emailRes.queued && emailRes.jobId) {
    const poll = await pollNotifyJob(emailRes.jobId);
    const { patch, toastOk, toastErr } = notifyResultFromPoll(poll, emailRes);
    if (toast) toast(toastOk || toastErr, toastOk ? 'ok' : 'err');
    return { poll, patch };
  }
  const waOk = emailRes?.whatsapp?.ok;
  const waCount = emailRes?.whatsappCount || 0;
  const emailOk = !!emailRes.ok;
  if (emailOk || waOk) {
    if (toast) toast('Notifications sent', 'ok');
    return { poll: null, patch: null };
  }
  if (toast) toast(`Notifications failed: ${formatUserNotifyError(emailRes.error, emailRes?.whatsapp?.error)}`, 'err');
  return { poll: null, patch: null };
}

/** Fire WhatsApp/email when task status changes (admin assignees + dept heads). */
export async function notifyTaskStatusChange(
  {
    projectId,
    taskId,
    projectName,
    phaseName,
    taskWho,
    taskName,
    author,
    oldLabel,
    newLabel,
  },
  toast
) {
  if (!author?.trim()) return;
  const lockKey = `${projectId}:${taskId || taskName}`;
  if (statusNotifyLock.has(lockKey)) return;
  statusNotifyLock.set(lockKey, true);
  try {
    const ctx = await loadNotifyContext(projectId, phaseName, taskWho);
    const recipients = mergeRecipients(ctx.autoRecipients || [], loadExtraRecipients(projectId));
    if (!hasNotifyTargets(recipients, ctx)) return;
    const emailRes = await notifyPreconUpdate({
      kind: 'status',
      projectId,
      phaseName,
      taskWho,
      projectName,
      taskName,
      author,
      text: `${oldLabel} → ${newLabel}`,
      nextAction: 'Review activity in PreConstruction',
      nextActionDate: new Date().toISOString().slice(0, 10),
    });
    await runPreconNotification(emailRes, toast);
  } catch (e) {
    toast(`Status notify failed: ${e?.message || e}`, 'err');
  } finally {
    setTimeout(() => statusNotifyLock.delete(lockKey), 4000);
  }
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
