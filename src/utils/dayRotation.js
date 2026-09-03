// Deterministic, day-based rotation helpers so the Home page's "trending"
// sections naturally cycle through different source queries / artist seeds
// every day instead of serving one static list forever.
const DAY_MS = 24 * 60 * 60 * 1000;

const getDayIndex = () => Math.floor(Date.now() / DAY_MS);

// Picks one entry from a list, cycling by day.
const pick = (list) => list[getDayIndex() % list.length];

// Splits a seed list into fixed-size blocks and returns the N blocks that
// "play today" (rotating start each day) — used to vary artist rosters.
const pickBlocks = (list, blockSize, blocksPerDay) => {
  if (!list.length || !blocksPerDay) return [];
  const blocks = [];
  for (let i = 0; i < list.length; i += blockSize) {
    blocks.push(list.slice(i, i + blockSize));
  }
  const start = (getDayIndex() * blocksPerDay) % blocks.length;
  const out = [];
  for (let k = 0; k < blocksPerDay; k += 1) {
    out.push(...blocks[(start + k) % blocks.length]);
  }
  return out;
};

module.exports = { getDayIndex, pick, pickBlocks };