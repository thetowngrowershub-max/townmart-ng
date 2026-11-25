export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/** Auth.js and our password sign-in must agree on the cookie name. */
export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export const VERIFY_EMAIL_TTL_HOURS = 24;
export const RESET_PASSWORD_TTL_MINUTES = 60;

export const tokenIdentifier = {
  verifyEmail: (email: string) => `verify-email:${email}`,
  resetPassword: (email: string) => `reset-password:${email}`,
  dataRequest: (requestId: string) => `data-request:${requestId}`,
};
