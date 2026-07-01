/** PreConstruction RBAC helpers (mirrors platform Admin Security). */

const PERM_ADMIN = 'manage_security';

/** Only platform admins (manage_security or admin role) may delete projects. */
export function canDeletePreconProjects(loginUser) {
  if (!loginUser?.ready || !loginUser?.authenticated) return false;
  const perms = loginUser.permissions || [];
  if (perms.includes(PERM_ADMIN)) return true;
  const roles = loginUser.roleIds || [];
  return roles.includes('admin');
}
