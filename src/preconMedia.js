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
  if (!res.ok) throw new Error(data?.error || `Email failed (${res.status})`);
  return data;
}

export function attachmentUrl(att) {
  if (att?.url) return att.url;
  if (att?.id) return `/api/preconstruction/attachments/${att.id}`;
  return '';
}
