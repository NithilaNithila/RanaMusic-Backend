/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn - The async function to retry.
 * @param {Object} opts
 * @param {number} opts.retries - Max retry attempts (default 2).
 * @param {number} opts.baseMs - Base delay in ms (default 300).
 * @param {Function} [opts.shouldRetry] - Predicate to decide if the error is retryable.
 * @returns {Promise<*>}
 */
const retry = async (fn, { retries = 2, baseMs = 300, shouldRetry = () => true } = {}) => {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const delay = baseMs * Math.pow(2, attempt) + Math.random() * baseMs;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
};

module.exports = { retry };
