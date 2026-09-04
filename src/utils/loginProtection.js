// Lightweight in-memory login brute-force protector.
//
// Tracks failed login attempts per email address. After
// MAX_FAILED_ATTEMPTS within the WINDOW_MS window the account is
// temporarily locked and login attempts are rejected with 429.
// Successful login clears the counter.

const windowMs = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

// Map<lowercaseEmail, { count, windowStart }>
const attempts = new Map();

// Periodic cleanup so the map doesn't grow unbounded after days of uptime.
const CLEANUP_INTERVAL = 5 * 60 * 1000; // every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [email, entry] of attempts) {
    if (now - entry.windowStart > windowMs) attempts.delete(email);
  }
}, CLEANUP_INTERVAL).unref();

const recordFailure = (email) => {
  const key = String(email || "").toLowerCase().trim();
  if (!key) return;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    attempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
};

const clearFailures = (email) => {
  const key = String(email || "").toLowerCase().trim();
  if (key) attempts.delete(key);
};

// Returns null when the account is not locked, or the remaining seconds
// until the lock expires.
const getLockRemaining = (email) => {
  const key = String(email || "").toLowerCase().trim();
  if (!key) return null;
  const entry = attempts.get(key);
  if (!entry) return null;
  const elapsed = Date.now() - entry.windowStart;
  if (elapsed > windowMs) {
    attempts.delete(key);
    return null;
  }
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    return Math.ceil((windowMs - elapsed) / 1000);
  }
  return null;
};

module.exports = { recordFailure, clearFailures, getLockRemaining };
