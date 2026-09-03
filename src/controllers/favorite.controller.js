const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const Favorite = require("../models/Favorite");
const { resolvePageOffset } = require("../utils/pagination");
const { getCache, setCache, delCache, makeCacheKey } = require("../services/cache.service");

const ITEM_TYPES = ["track", "album", "artist"];

// GET /api/favorites?itemType=track|album|artist&page=&limit=&offset=
// Cached per user per type (cache key matches the invalidation keys used by
// add/remove, so mutations always refresh it). The response body stays an
// array (backward compatible); pagination metadata is exposed via headers.
const FAVORITES_MAX = 500;

const getMyFavorites = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.itemType) {
    if (!ITEM_TYPES.includes(req.query.itemType)) {
      return ApiResponse.error(res, `itemType must be one of: ${ITEM_TYPES.join(", ")}`, 400);
    }
    filter.itemType = req.query.itemType;
  }

  const pag = resolvePageOffset(req.query, FAVORITES_MAX);
  const cachedType = req.query.itemType || "all";

  // Cache the full (newest-first, capped) list under the stable key so the
  // same invalidation keys used by add/remove clear it, and paginate per
  // request by slicing. total is the cached list length (capped at 500).
  const key = makeCacheKey(`favorites:user:${req.user._id}`, { itemType: cachedType });
  let list = getCache(key);
  if (!list) {
    list = await Favorite.find(filter).sort({ createdAt: -1 }).limit(FAVORITES_MAX).lean();
    setCache(key, list, 30);
  }

  const total = list.length;
  const slice = list.slice(pag.offset, pag.offset + pag.limit);

  res
    .set("X-Total-Count", String(total))
    .set("X-Page", String(pag.page))
    .set("X-Limit", String(pag.limit))
    .set("X-Has-More", String(pag.offset + pag.limit < total));
  return ApiResponse.success(res, slice);
});

// POST /api/favorites
const addFavorite = asyncHandler(async (req, res) => {
  const { itemType, jamendoId, meta } = req.body;
  if (!itemType || !jamendoId) {
    return ApiResponse.error(res, "itemType and jamendoId are required", 400);
  }
  if (!ITEM_TYPES.includes(itemType)) {
    return ApiResponse.error(res, `itemType must be one of: ${ITEM_TYPES.join(", ")}`, 400);
  }

  const existing = await Favorite.findOne({
    user: req.user._id,
    itemType,
    jamendoId,
  }).lean();
  if (existing) return ApiResponse.success(res, existing, "Already favorited");

  const favorite = await Favorite.create({
    user: req.user._id,
    itemType,
    jamendoId,
    meta,
  });

  delCache(makeCacheKey(`favorites:user:${req.user._id}`, { itemType: "all" }));
  delCache(makeCacheKey(`favorites:user:${req.user._id}`, { itemType }));

  return ApiResponse.success(res, favorite, "Added to favorites", 201);
});

// DELETE /api/favorites/:itemType/:jamendoId
const removeFavorite = asyncHandler(async (req, res) => {
  const { itemType, jamendoId } = req.params;

  await Favorite.findOneAndDelete({
    user: req.user._id,
    itemType,
    jamendoId,
  });

  delCache(makeCacheKey(`favorites:user:${req.user._id}`, { itemType: "all" }));
  delCache(makeCacheKey(`favorites:user:${req.user._id}`, { itemType }));

  return ApiResponse.success(res, {}, "Removed from favorites");
});

module.exports = { getMyFavorites, addFavorite, removeFavorite };