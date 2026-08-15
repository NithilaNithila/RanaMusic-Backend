const ApiResponse = require("../utils/apiResponse");

// Simple field-presence validator factory.
// Usage: validate(["email", "password"])
const validate = (requiredFields = []) => (req, res, next) => {
  const missing = [];
  const invalid = [];

  for (const field of requiredFields) {
    const value = req.body[field];
    if (value === undefined || value === "") {
      missing.push(field);
    } else if (typeof value !== "string") {
      invalid.push(field);
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

  next();
};

module.exports = validate;
