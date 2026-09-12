/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn - The async function to retry.
 * @param {Object} opts
 * @param {number} opts.retries - Max retry attempts (default 2).
 * @param {number} opts.baseMs - Base delay in ms (default 300).
 * @param {number} [opts.maxTotalMs] - Hard deadline in ms; aborts retries when exceeded.
 * @param {Function} [opts.shouldRetry] - Predicate to decide if the error is retryable.
 * @returns {Promise<*>}
 */
const retry = async (fn, { retries = 2, baseMs = 300, maxTotalMs = 0, shouldRetry = () => true } = {}) => {
  let lastErr;
  const deadline = maxTotalMs > 0 ? Date.now() + maxTotalMs : 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !shouldRetry(err)) throw err;
      if (deadline && Date.now() >= deadline) throw err;

      // Honor a Retry-After header from 429 responses as a MINIMUM delay (the
      // upstream told us when to come back — anything sooner invites another
      // 429). Services surface it on the typed error as `retryAfterMs`; fall
      // back to reading the raw axios header. The jittered backoff still floors
      // the wait for small headers.
      const retryAfterMs =
        Number(err?.retryAfterMs) ||
        Number(err?.response?.headers?.["retry-after"]) * 1000 ||
        0;
      let delay = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
      if (retryAfterMs > 0) delay = Math.max(delay, retryAfterMs);
      if (deadline) delay = Math.min(delay, deadline - Date.now());
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
};

module.exports = { retry };
