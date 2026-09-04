const ApiResponse = require("../utils/apiResponse");

// App-update policy. Tunable at deploy time via env vars so the v1.0 →
// v2.0 sunset can be managed without code changes. Defaults are safe for a
// fresh rollout: nothing is enforced until you raise MIN_APP_VERSION.
const POLICY = {
  // Lowest app version still allowed to use the API.
  minVersion: process.env.MIN_APP_VERSION || "1.0.0",
  // Latest published app version (drives the soft "update available" prompt).
  latestVersion: process.env.LATEST_APP_VERSION || "2.0.0",
  // "force" blocks old clients, "soft" just nudges, "none" shows nothing.
  // Derived from whether the client's version is below minVersion.
  updateMessage:
    process.env.APP_UPDATE_MESSAGE ||
    "A newer version of RanaMusic is available. Please update to continue.",
  // Store URLs opened when the user taps "Update".
  androidStoreUrl:
    process.env.ANDROID_STORE_URL || "https://play.google.com/store/apps/details?id=com.ranamusic.app",
  iosStoreUrl:
    process.env.IOS_STORE_URL || "https://apps.apple.com/app/id0000000000",
};

// GET /api/app-version — returns the gate the mobile client should enforce.
// The client compares its own installed version against minVersion: below it
// → force update; behind latestVersion → soft prompt; otherwise → no-op.
const getAppVersion = (req, res) => {
  return ApiResponse.success(
    res,
    {
      platform: String(req.query.platform || "").toLowerCase(),
      min_version: POLICY.minVersion,
      latest_version: POLICY.latestVersion,
      update_message: POLICY.updateMessage,
      store_url_android: POLICY.androidStoreUrl,
      store_url_ios: POLICY.iosStoreUrl,
    },
    "App version policy"
  );
};

module.exports = { getAppVersion };
