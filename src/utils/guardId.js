// Guards entity id route params against invalid values ("null", "undefined",
// empty, etc.) that clients can produce when a track/playlist song has no
// album. Rejecting at the router keeps those calls from becoming a misleading
// 404 ("Album not found") and from firing pointless upstream lookups.
const ApiResponse = require("./apiResponse");

const validId = (id) =>
  id !== null &&
  id !== undefined &&
  typeof id === "string" &&
  id.trim() !== "" &&
  id.trim().toLowerCase() !== "null" &&
  id.trim().toLowerCase() !== "undefined";

const guardId = (param = "id", entity = "entity") => {
  if (!param) throw new Error("guardId requires a param name");
  return (req, res, next) => {
    if (!validId(req.params[param])) {
      return ApiResponse.error(res, `Invalid ${entity} id`, 400);
    }
    return next();
  };
};

module.exports = { validId, guardId };