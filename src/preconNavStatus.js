/**
 * Compact nav-bar status — no blocking toasts. Mongo badge handles save/sync.
 * Returns { show, short, full, type } for the top nav hint.
 */
export function formatNavStatusMessage(msg, type = '') {
  const full = String(msg || '').trim();
  if (!full) return { show: false, short: '', full: '', type: '' };

  const t = type || 'info';

  // Mongo / save success — cloudStatus badge only
  if (
    t === 'ok' &&
    /^(Saved to Mongo|Saved \(version|Saved \(merged|New PreConstruction update)/i.test(full)
  ) {
    return { show: false, short: '', full, type: t };
  }

  // Routine success — silent (editing should not be interrupted)
  if (
    t === 'ok' &&
    /^(Comment saved|Marked complete|Task order|Section order|Files uploaded|Phase added|Project (created|updated|deleted)|Notifications sent|JSON exported|Excel|CSV exported|Department heads|Pushed to cloud|Pulled|Notify)/i.test(
      full,
    )
  ) {
    return { show: false, short: '', full, type: t };
  }

  if (t === 'ok' && /^(Sending notifications|Pulling from cloud)/i.test(full)) {
    return { show: false, short: '', full, type: t };
  }

  // Errors & conflicts — compact pill in nav (full text on hover)
  if (t === 'err' || /failed|conflict|unavailable|required/i.test(full)) {
    let short = 'Error';
    if (/notification/i.test(full)) short = 'Notify ✗';
    else if (/mongo|save conflict/i.test(full)) short = 'Save ✗';
    else if (full.length <= 26) short = full;
    else short = `${full.slice(0, 24)}…`;
    return { show: true, short, full, type: 'err' };
  }

  // Validation / short warnings
  if (full.length <= 28) {
    return { show: true, short: full, full, type: t === 'err' ? 'err' : 'info' };
  }

  return { show: true, short: `${full.slice(0, 26)}…`, full, type: t === 'err' ? 'err' : 'info' };
}
