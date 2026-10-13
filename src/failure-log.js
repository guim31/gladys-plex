// -----------------------------------------------------------------------------
// Deduplicated failure logs.
//
// A refresh loop that fails every 10 s while the Plex server is down must not
// write one warning per attempt: the first failure is logged as a warning, the
// following ones only in debug, and the recovery gets a single info line.
// -----------------------------------------------------------------------------

export class FailureLog {
  /**
   * @param {{ warn: Function, info: Function, debug: Function }} logger
   * @param {string} label - What failed, e.g. "Session refresh".
   * @param {{ redact?: (message: string) => string }} [options] - Masks
   *   secrets in the error messages before they are logged.
   */
  constructor(logger, label, { redact = (message) => message } = {}) {
    this.logger = logger;
    this.label = label;
    this.redact = redact;
    this.count = 0;
  }

  /**
   * Record a failed attempt.
   * @param {Error} err
   * @returns {number} Consecutive failures so far, this one included.
   */
  failed(err) {
    this.count += 1;
    const message = this.redact(String(err?.message ?? err));
    if (this.count === 1) {
      this.logger.warn(`${this.label} failed: ${message} (retrying silently)`);
    } else {
      this.logger.debug(`${this.label} failed (${this.count} in a row): ${message}`);
    }
    return this.count;
  }

  /**
   * Record a successful attempt.
   * @returns {number} Consecutive failures that preceded it (0 when none).
   */
  succeeded() {
    const previous = this.count;
    if (previous > 0) {
      this.logger.info(`${this.label} working again after ${previous} failed attempt(s)`);
    }
    this.count = 0;
    return previous;
  }
}
