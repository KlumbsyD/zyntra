// Decides whether the web dashboard may run, given the configured password.
// Fail closed: an unset or obviously weak password disables the dashboard
// entirely rather than serving it unprotected.

const WEAK_PASSWORDS = new Set(['changeme', 'password', 'admin']);

function resolveWebAuth(webPassword) {
  const password = typeof webPassword === 'string' ? webPassword.trim() : '';
  if (!password) {
    return { enabled: false, reason: 'WEB_PASSWORD is not set — dashboard disabled.' };
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { enabled: false, reason: 'WEB_PASSWORD is an insecure default — dashboard disabled.' };
  }
  return { enabled: true, password };
}

module.exports = { resolveWebAuth };
