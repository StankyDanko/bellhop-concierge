// Typed errors so every tool can turn a failure into an honest response.
// A tool never reports success it did not get (the "false Sent" lesson).

export class UpstreamError extends Error {
  /**
   * @param {string} message
   * @param {{ service: string, code: string, status?: number, retryable?: boolean }} info
   */
  constructor(message, { service, code, status, retryable = false }) {
    super(message);
    this.name = 'UpstreamError';
    this.service = service;
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Thrown when an outbound request would carry something that looks like personal data. */
export class PiiViolation extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PiiViolation';
  }
}

/** Input that fails validation at the tool boundary. Maps to HTTP 400. */
export class InputError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}
