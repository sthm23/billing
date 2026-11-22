type AccountFlags = {
  auth?: { isActive: boolean } | null;
  staff?: { isActive: boolean } | null;
};

/**
 * A user may sign in, refresh tokens and call the API only while both the
 * login (AuthAccount) and the employee record (Staff, if any) are active.
 * A deactivated employee is cut off at once: the JWT strategy reloads the
 * user on every request.
 */
export function isAccountActive(user: AccountFlags): boolean {
  return user.auth?.isActive !== false && user.staff?.isActive !== false;
}
