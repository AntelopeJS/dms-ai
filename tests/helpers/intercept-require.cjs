const Module = require("node:module");
const { z } = require("zod");

const RequireMethod = z.instanceof(Function);

/**
 * Makes the requires of the modules loaded from now on resolve to the mocks.
 *
 * @param {Record<string, unknown>} mocks - Exports by module specifier.
 * @param {boolean} stubUnmocked - Whether a specifier with no mock resolves to an empty module, instead of the real one, for the modules this test did not load itself.
 * @param {NodeJS.Module} testModule - The test module, whose own requires are never stubbed.
 * @returns {() => void} Puts the real require back.
 */
function interceptRequire(mocks, stubUnmocked, testModule) {
  const originalRequire = RequireMethod.parse(
    Object.getOwnPropertyDescriptor(Module.prototype, "require")?.value,
  );
  /**
   * @this {Module}
   * @param {string} request - The specifier being required.
   * @returns {unknown} The mock of the specifier, else the module it resolves to.
   */
  Module.prototype.require = function (request) {
    return (
      mocks[request] ??
      (stubUnmocked && this !== testModule
        ? {}
        : originalRequire.call(this, request))
    );
  };
  return () => {
    Object.defineProperty(Module.prototype, "require", {
      value: originalRequire,
    });
  };
}

module.exports = { interceptRequire };
