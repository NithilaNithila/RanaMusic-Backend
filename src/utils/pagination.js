// Centralized pagination helpers. Previously each controller re-implemented
// `page`/`offset` conversion with subtle differences; these helpers make every
// list endpoint behave identically.

// NOTE: `sanitizePagination` keeps its historical 0-based-page semantics because
// it feeds the Saavn/JioSaavn service layer, which sends `page + 1` to the
// upstream (so 0 == first page there). Do not change the default.

// Sanitizes { page, limit } for the Saavn/JioSaavn upstream services.
// Returns a 0-indexed page (0 == first page upstream).
const sanitizePagination = ({ page, limit } = {}, max = 50) => ({
  page: Math.max(parseInt(page, 10) || 0, 0),
  limit: Math.min(Math.max(parseInt(limit, 10) || 20, 1), max),
});

// Public-facing helper: resolves user-supplied `page`/`offset` (either may be
// provided) into a 1-indexed page and a 0-indexed offset for a given limit.
// Both `page` and `offset` are clamps so a single source of truth removes the
// drift across controllers.
const resolvePageOffset = ({ page, offset, limit } = {}, max = 50) => {
  const { limit: lim } = sanitizePagination({ page, limit }, max);
  const hasOffset = offset !== undefined && offset !== null && offset !== "";
  const off = hasOffset
    ? Math.max(parseInt(offset, 10) || 0, 0)
    : (Math.max(parseInt(page, 10) || 1, 1) - 1) * lim;
  const pageNum = hasOffset ? Math.floor(off / lim) + 1 : Math.max(parseInt(page, 10) || 1, 1);
  return { page: pageNum, offset: off, limit: lim };
};

// Convenience for a fully-paginated response payload.
const paginatedPayload = ({ results, total, page, limit }) => ({
  results,
  total,
  page,
  limit,
  hasMore: page * limit < total,
});

module.exports = { sanitizePagination, resolvePageOffset, paginatedPayload };
