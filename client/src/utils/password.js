// Mirror of server/src/utils/passwordPolicy.js, for instant feedback while
// typing. The server is the authority - it re-checks every password it stores.
export const PASSWORD_HINT = 'At least 8 characters, including a number.'

/** Returns an error message, or '' when the password is acceptable. */
export function passwordProblem(password) {
  if (!password) return ''
  if (password.length < 8) return 'Use at least 8 characters'
  if (!/[0-9]/.test(password)) return 'Include at least one number'
  return ''
}

export const isPasswordValid = (password) => Boolean(password) && !passwordProblem(password)
