const Module = require("node:module");
const { z } = require("zod");

const RequireMethodSchema = z.instanceof(Function);

/**
 * Makes every `require` answer the module registered under its request string
 * in `mocks`, and fall through to the real loader for any other request.
 * Returns a function that puts the real `require` back.
 * @param {ReadonlyMap<string, unknown>} mocks
 * @returns {() => void}
 */
function installRequireMocks(mocks) {
  const original = RequireMethodSchema.parse(
    Object.getOwnPropertyDescriptor(Module.prototype, "require")?.value,
  );
  /**
   * @this {Module}
   * @param {string} request
   * @returns {unknown}
   */
  Module.prototype.require = function (request) {
    return mocks.has(request)
      ? mocks.get(request)
      : original.call(this, request);
  };
  return () => {
    Object.defineProperty(Module.prototype, "require", { value: original });
  };
}

module.exports = { installRequireMocks };
