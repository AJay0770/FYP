/**
 * The one password rule for every place an account is created: self
 * registration, a client created alongside a project, and accounts an admin
 * creates. Kept here so the rule can't drift between routes.
 *
 * Checked only when a password is *set* - login never re-validates, so older
 * accounts keep working until their password is next changed.
 */
const MIN_LENGTH = 8;

/** Returns an error message, or null when the password is acceptable. */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return `Password must be at least ${MIN_LENGTH} characters`;
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}

module.exports = { passwordProblem, PASSWORD_MIN_LENGTH: MIN_LENGTH };
