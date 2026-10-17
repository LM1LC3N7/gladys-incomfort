// -----------------------------------------------------------------------------
// GatewayError: every failure of a request to the Lan2RF gateway, with a code
// the app maps to a status, a retry policy or a message. Messages are built
// here from codes and HTTP statuses only: never the text of an answer, never
// the user name or the password.
// -----------------------------------------------------------------------------

export const CODES = Object.freeze({
  UNREACHABLE: 'unreachable', // no TCP connection
  TIMEOUT: 'timeout', // no answer in time
  HTTP: 'http', // an HTTP status other than 2xx (see `status`)
  BAD_ANSWER: 'bad_answer', // not the JSON expected
  TOO_LARGE: 'too_large', // answer above the size cap
  CLOSED: 'closed', // the client was replaced (new configuration)
  NO_TIME: 'no_time', // the deadline of a command left no room: not sent
});

export class GatewayError extends Error {
  constructor(code, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    if (status !== undefined) this.status = status;
    if (retryAfterMs !== undefined && retryAfterMs !== null) this.retryAfterMs = retryAfterMs;
  }
}

/** The gateway refused the user name / password, or asks for them (HTTP 401). */
export const isAuthRefused = (err) => err?.code === CODES.HTTP && err.status === 401;
