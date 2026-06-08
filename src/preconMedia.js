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

function formatWhatsAppPollError(wa) {
  if (!wa) return '';
  if (wa.error) return wa.error;
  if (Array.isArray(wa.errors) && wa.errors.length) {
    return wa.errors.map((e) => e.error || e.to).filter(Boolean).join('; ');
  }
  return '';
}

export function notifyResultFromPoll(poll, emailRes) {
  const recipients = emailRes?.recipients || poll?.result?.recipients || [];
  const res = poll?.result || {};
  const emailDelivered = Boolean(res.ok && res.via && (res.sentTo?.length || res.via));
  const waOk = Boolean(res.whatsapp?.ok && (res.whatsappCount || res.whatsapp?.sent?.length));
  const waCount = res.whatsappCount || res.whatsapp?.sent?.length || 0;
  const anyOk = poll?.status === 'sent' && (res.ok || emailDelivered || waOk);

  if (anyOk && (emailDelivered || waOk)) {
    const parts = [];
    if (emailDelivered) parts.push(`email ${res.sentTo?.length || recipients.length}`);
    if (waOk && waCount) parts.push(`WhatsApp ${waCount}`);
    return {
      patch: {
        emailQueued: false,
        emailSent: !!emailDelivered,
        emailError: emailDelivered ? '' : res.error ? `(email skipped) ${res.error}` : '',
        whatsappSent: waOk,
        whatsappError: '',
        notifyRecipients: recipients,
        notifyPending: false,
      },
      toastOk: `Notifications sent (${parts.join(', ') || 'ok'})`,
    };
  }

  const waErr = formatWhatsAppPollError(res.whatsapp);
  const err =
    poll?.error ||
    res.error ||
    waErr ||
    'Notifications failed — check Twilio on Render and WhatsApp sandbox join on each phone';
  return {
    patch: {
      emailQueued: false,
      emailSent: false,
      emailError: err,
      whatsappSent: false,
      whatsappError: waErr || err,
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
