// Lightweight in-memory login brute-force protector.
//
// Tracks failed login attempts per (email, source-IP) bucket. After
// MAX_FAILED_ATTEMPTS within the WINDOW_MS window that bucket is temporarily
// locked and further attempts from it are rejected with 429.
//
// Bucketing by IP (not just email) closes the trivial DoS: an attacker could
// otherwise lock a victim's account by spamming wrong passwords against their
// email from an unrelated address. With per-IP buckets only the attacker's own
// IP gets throttled while the legitimate user keeps their (separate) budget.
// Successful login clears every bucket belonging to that email.

const windowMs = 15 * 60 * 1000; // 15 minutes
const MAX_FAILED_ATTEMPTS = 5;

// Keys are `${lowercaseEmail}:${ip}`.
const attempts = new Map();

// Periodic cleanup so the map doesn't grow unbounded after days of uptime.
const CLEANUP_INTERVAL = 5 * 60 * 1000; // every 5 min
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now - entry.windowStart > windowMs) attempts.delete(key);
  }
}, CLEANUP_INTERVAL).unref();

const makeKey = (email, ip) => {
  const e = String(email || "").toLowerCase().trim();
  if (!e) return "";
  const cidr = String(ip || "").split(",").pop().trim() || "unknown";
  return `${e}:${cidr}`;
};

const recordFailure = (email, ip) => {
  const key = makeKey(email, ip);
  if (!key) return;
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStart > windowMs) {
    attempts.set(key, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
};

// Removes every failure bucket for an email regardless of source IP.
const clearFailures = (email) => {
  const e = String(email || "").toLowerCase().trim();
  if (!e) return;
  const prefix = `${e}:`;
  for (const key of attempts.keys()) {
    if (key.startsWith(prefix)) attempts.delete(key);
  }
};

// Returns null when the bucket is not locked, or the remaining seconds
// until the lock expires.
const getLockRemaining = (email, ip) => {
  const key = makeKey(email, ip);
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