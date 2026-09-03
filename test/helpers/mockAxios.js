// Test helper: stubs the `axios` module in `require.cache` BEFORE a service
// module is first required, so the service's `axios.create(...)` returns a
// client whose `get()` is fully controlled by the test.
const realAxios = require("axios");

// current handler: (path, config) => Promise<{ data }> | throw
let handler = null;
let lastClientOptions = null;
let createdCount = 0;

const mockGet = (path, config) => {
  if (!handler) return Promise.reject(new Error("mock axios: no handler set"));
  return handler(path, config);
};

const mockCreate = (options) => {
  lastClientOptions = options;
  createdCount += 1;
  return { get: mockGet };
};

const install = () => {
  // Remove any previously cached axios so requiring it re-runs create().
  delete require.cache[require.resolve("axios")];
  require.cache[require.resolve("axios")] = {
    id: require.resolve("axios"),
    filename: require.resolve("axios"),
    loaded: true,
    exports: {
      create: mockCreate,
      isAxiosError: false,
    },
  };
};

const reset = () => {
  handler = null;
  lastClientOptions = null;
  createdCount = 0;
};

const setHandler = (fn) => {
  handler = fn;
};

// Sets a handler that resolves with a fixed response object (wrapped in {data})
// for any path, or throws a shaped error for a given status.
const respond = (data) => {
  handler = () => Promise.resolve({ data });
};

const fail = (status, message, withResponse = true) => {
  handler = () => {
    const err = new Error(message || `mock error ${status}`);
    err.isAxiosError = true;
    if (withResponse) {
      err.response = {
        status,
        data: { error: message || `error ${status}`, message },
      };
    }
    return Promise.reject(err);
  };
};

// Load a source module fresh (after stubbing axios) and return its exports.
// `modulePath` is resolved relative to the project root (this helper lives in
// test/helpers/, so the root is two levels up).
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
const fresh = (modulePath) => {
  // Test files pass paths like "../src/services/x" relative to the test dir;
  // from ROOT that equals "./src/services/x".
  const rel = modulePath.replace(/^(\.\.\/)+/, "./");
  const resolved = path.resolve(ROOT, rel);
  delete require.cache[resolved];
  return require(resolved);
};

// Restore the real axios and purge any modules that captured the mock.
const restore = () => {
  delete require.cache[require.resolve("axios")];
  // Re-require to restore real axios (in case future code uses it).
  require("axios");
};

module.exports = {
  install,
  reset,
  setHandler,
  respond,
  fail,
  fresh,
  restore,
  get: {
    lastClientOptions: () => lastClientOptions,
    createdCount: () => createdCount,
  },
  realAxios,
};
