const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const searchService = require("../services/search.service");

const search = asyncHandler(async (req, res) => {
  const { q, type, limit, offset } = req.query;
  if (!q) return ApiResponse.error(res, "Query param 'q' is required", 400);

  // The service's memoize handles caching and thundering-herd protection.
  const data = await searchService.search(q, { type, limit, offset });
  return ApiResponse.success(res, data.results, `Found ${data.total} results`);
});

module.exports = { search };