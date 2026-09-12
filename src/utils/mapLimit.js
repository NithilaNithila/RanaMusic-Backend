// Runs `fn` over items with at most `limit` promises in flight. Preserves
// input order in the output. Shared by services/controllers that fan out
// per-item upstream work (playlist audio enrichment, search resolution).
const mapLimit = async (items, limit, fn) => {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, Math.max(items.length, 0)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return out;
};

module.exports = mapLimit;