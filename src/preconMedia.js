const ACCEPT =
  'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const ATTACHMENT_ACCEPT = ACCEPT;

export function attachmentKindFromFile(file) {
  const t = String(file?.type || '').toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  return 'document';
}

export function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fetchNotifyRecipients(projectId, { phaseName, taskWho } = {}) {
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

export async function uploadAttachments({ projectId, taskId, scope, files, labels }) {
  const fd = new FormData();
  fd.append('projectId', projectId || '');
  fd.append('taskId', taskId || '');
  fd.append('scope', scope || 'comment');
  fd.append('labels', JSON.stringify(labels || []));
  (files || []).forEach((f) => fd.append('files', f));
  const res = await fetch('/api/preconstruction/attachments', {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
  return data.attachments || [];
}

export async function sendCommentNotification(payload) {
  const res = await fetch('/api/preconstruction/notify-comment', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 202 || data?.queued) {
    return { ok: true, queued: true, ...data };
  }
  if (!res.ok) {
    return { ok: false, error: data?.error || `Notify failed (${res.status})`, ...data };
  }
  return data;
}

/** Poll background notify job until sent/failed or timeout. */
export async function pollNotifyJob(jobId, { maxMs = 50_000, intervalMs = 2_000 } = {}) {
  if (!jobId) return null;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`/api/preconstruction/notify-status/${encodeURIComponent(jobId)}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { status: 'failed', error: data?.error || `Status failed (${res.status})` };
    if (data.status === 'sent' || data.status === 'failed') return data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: 'timeout', error: 'Notification still processing — check inbox shortly' };
}

export function notifyResultFromPoll(poll, emailRes) {
  const recipients = emailRes?.recipients || poll?.result?.recipients || [];
  const emailSent = Boolean(poll?.result?.sentTo?.length || poll?.result?.via);
  const waOk = poll?.result?.whatsapp?.ok;
  const waCount = poll?.result?.whatsappCount || 0;
  const anyOk = poll?.status === 'sent' && (emailSent || waOk);

  if (anyOk) {
    const parts = [];
    if (emailSent) parts.push(`email ${poll.result.sentTo?.length || recipients.length}`);
    if (waOk && waCount) parts.push(`WhatsApp ${waCount}`);
    return {
      patch: {
        emailQueued: false,
        emailSent: !!emailSent,
        emailError: emailSent ? '' : poll?.result?.error || '',
        notifyRecipients: recipients,
        notifyPending: false,
      },
      toastOk: `Notifications sent (${parts.join(', ') || 'ok'})`,
    };
  }

  const err =
    poll?.error ||
    poll?.result?.error ||
    'Email failed — set SMTP_PORT=465 and Google App password on Render';
  return {
    patch: {
      emailQueued: false,
      emailSent: false,
      emailError: err,
      notifyRecipients: recipients,
      notifyPending: false,
    },
    toastErr: `Notifications failed: ${err}`,
  };
}

export function attachmentUrl(att) {
  if (att?.url) return att.url;
  if (att?.id) return `/api/preconstruction/attachments/${att.id}`;
  return '';
}
