const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const searchService = require("../services/search.service");

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);

  // Partial mode: return Saavn results immediately, other providers load in background
  const partial = req.query.partial === "1";

  // The service's memoize handles caching and thundering-herd protection.
  // In partial mode, we still await but the service returns Saavn-first with
  // background enrichment for fastest possible response.
  const data = await searchService.search(q, { type, limit, offset, partial });

  if (partial && data.partial) {
    // Return Saavn results immediately with indicator
    return ApiResponse.success(
      res,
      data.results,
      `Found ${data.total} results (Saavn primary, other sources loading in background)`
    );
  }

  return ApiResponse.success(res, data.results, `Found ${data.total} results`);
});

module.exports = { search };