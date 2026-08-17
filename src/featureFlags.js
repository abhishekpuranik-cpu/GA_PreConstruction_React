/**
 * PreConstruction Tasks tab layout flag. V2.3 is the default for everyone.
 * PRECON_V2_PROJECT_VIEW was the pilot key; a stale 'false' left in a browser
 * during the flag-off pilot would pin it to the old accordion, so it is cleared.
 * Set VITE_PRECON_V2_PROJECT_VIEW=false for an emergency global rollback.
 */
const PILOT_KEY = 'PRECON_V2_PROJECT_VIEW';
const OVERRIDE_KEY = 'PRECON_TASKS_VIEW';

export function isV2Enabled() {
  try {
    localStorage.removeItem(PILOT_KEY);
    const o = localStorage.getItem(OVERRIDE_KEY);
    if (o === 'true') return true;
    if (o === 'false') return false;
  } catch {
    /* private mode */
  }
  return import.meta.env.VITE_PRECON_V2_PROJECT_VIEW !== 'false';
}
