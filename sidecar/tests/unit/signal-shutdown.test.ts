import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { installSignalShutdown } from "../../src/index.js";

const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

describe("installSignalShutdown", () => {
  it.each(SHUTDOWN_SIGNALS)("shuts down gracefully on %s", (signal) => {
    const source = new EventEmitter();
    let shutdowns = 0;
    installSignalShutdown(() => shutdowns++, source);
    source.emit(signal);
    expect(shutdowns).toBe(1);
  });
});
