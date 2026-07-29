const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const Favorite = require("../models/Favorite");

// GET /api/favorites?itemType=track|album|artist
const getMyFavorites = asyncHandler(async (req, res) => {
  const filter = { user: req.user._id };
  if (req.query.itemType) filter.itemType = req.query.itemType;

  const favorites = await Favorite.find(filter).sort({ createdAt: -1 });
  return ApiResponse.success(res, favorites);
});

// POST /api/favorites
const addFavorite = asyncHandler(async (req, res) => {
  const { itemType, jamendoId, meta } = req.body;
  if (!itemType || !jamendoId) {
    return ApiResponse.error(res, "itemType and jamendoId are required", 400);
  }

  const existing = await Favorite.findOne({
    user: req.user._id,
    itemType,
    jamendoId,
  });
  if (existing) return ApiResponse.success(res, existing, "Already favorited");

  const favorite = await Favorite.create({
    user: req.user._id,
    itemType,
    jamendoId,
    meta,
  });

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

  return ApiResponse.success(res, {}, "Removed from favorites");
});

module.exports = { getMyFavorites, addFavorite, removeFavorite };
