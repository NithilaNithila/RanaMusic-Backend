const jwt = require("jsonwebtoken");
const crypto = require("crypto");

// Token lifetime is configurable via JWT_EXPIRES_IN (ms or "1d"/"7d"/"30d").
// 7 days is a sane default for a long-lived mobile/web-session token; lower it
// in high-security deployments. Issuer/audience are embedded so middleware can
// cryptographically bind verification to THIS service rather than trusting any
// token signed with the same secret elsewhere.
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";
const JWT_ISSUER = process.env.JWT_ISSUER || "rana-music";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "rana-music-client";

const generateToken = (userId) => {
  // jti (jwt id) makes tokens individually identifiable so a future revocation
  // list or audit trail can reference a specific token, not just a user.
  return jwt.sign(
    {
      id: userId,
      jti: crypto.randomUUID(),
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      algorithm: "HS256",
    }
  );
};

module.exports = generateToken;
module.exports.JWT_ISSUER = JWT_ISSUER;
module.exports.JWT_AUDIENCE = JWT_AUDIENCE;
