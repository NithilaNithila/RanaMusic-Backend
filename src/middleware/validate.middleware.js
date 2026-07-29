const ApiResponse = require("../utils/apiResponse");

// Simple field-presence validator factory.
// Usage: validate(["email", "password"])
const validate = (requiredFields = []) => (req, res, next) => {
  const missing = requiredFields.filter(
    (field) => req.body[field] === undefined || req.body[field] === ""
  );

  if (missing.length > 0) {
    return ApiResponse.error(
      res,
      `Missing required field(s): ${missing.join(", ")}`,
      400
    );
  }

  next();
};

module.exports = validate;
