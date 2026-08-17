/**
 * PreConstruction V2 Tasks tab feature flag.
 * Runtime localStorage overrides env default (unset = true).
 * Set VITE_PRECON_V2_PROJECT_VIEW=false for an emergency global rollback.
 */
export function isV2Enabled() {
  try {
    const o = localStorage.getItem('PRECON_V2_PROJECT_VIEW');
    if (o === 'true') return true;
    if (o === 'false') return false;
  } catch {
    /* private mode */
  }
  return import.meta.env.VITE_PRECON_V2_PROJECT_VIEW !== 'false';
}
