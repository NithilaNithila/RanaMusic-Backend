const ApiResponse = require("../utils/apiResponse");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Reasonable caps that prevent absurdly large payloads from reaching the
// DB layer. Values match (or are tighter than) the Mongoose schema limits.
const LENGTH_LIMITS = {
  username: { min: 3, max: 30 },
  email: { min: 3, max: 254 },
  password: { min: 8, max: 72 }, // bcrypt truncates past 72 bytes
  name: { min: 1, max: 200 },
  description: { min: 0, max: 1000 },
};

// Optional per-route overrides, e.g. { password: { min: 8 } }
const withLimits = (field, overrides) => ({
  ...(LENGTH_LIMITS[field] || {}),
  ...(overrides?.[field] || {}),
});

// Simple field-presence + type + length + email validator factory.
// Usage: validate(["email", "password"])
//        validate(["password"], { password: { min: 8 } })
const validate = (requiredFields = [], overrides = {}) => (req, res, next) => {
  const missing = [];
  const invalid = [];
  const badLength = [];
  const badEmail = [];

  for (const field of requiredFields) {
    const value = req.body[field];
    if (value === undefined || value === "") {
      missing.push(field);
      continue;
    }
    if (typeof value !== "string") {
      invalid.push(field);
      continue;
    }

    const { min = 0, max = Infinity } = withLimits(field, overrides);
    const len = value.length;
    if (len < min || len > max) {
      badLength.push(field);
      continue;
    }

    if (field === "email" && !EMAIL_RE.test(value.trim())) {
      badEmail.push(field);
    }
  }

  if (missing.length > 0) {
    return ApiResponse.error(
      res,
      `Missing required field(s): ${missing.join(", ")}`,
      400
    );
  }

  if (invalid.length > 0) {
    return ApiResponse.error(
      res,
      `Field(s) must be strings: ${invalid.join(", ")}`,
      400
    );
  }

  if (badLength.length > 0) {
    return ApiResponse.error(res, `Invalid length for field(s): ${badLength.join(", ")}`, 400);
  }

  if (badEmail.length > 0) {
    return ApiResponse.error(res, `Invalid email address: ${badEmail.join(", ")}`, 400);
  }

  next();
};

module.exports = validate;
module.exports.EMAIL_RE = EMAIL_RE;
module.exports.LENGTH_LIMITS = LENGTH_LIMITS;
