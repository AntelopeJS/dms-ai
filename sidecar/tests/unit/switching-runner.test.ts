import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../../src/agent/runner.js";
import { createSwitchingRunner } from "../../src/agent/switching-runner.js";
import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import type { AppSettings } from "../../src/state/settings-types.js";
import type { ProviderName } from "../../src/state/types.js";

interface Trace {
  built: ProviderName[];
  disposed: ProviderName[];
  applied: ProviderName[];
}

function fakeRunner(name: ProviderName, trace: Trace): AgentRunner {
  return {
    start: async function* () {},
    interruptSession: () => {},
    disposeSession: () => {},
    applySettings: () => trace.applied.push(name),
    dispose: () => trace.disposed.push(name),
  };
}

function build(trace: Trace) {
  const factory = (name: ProviderName) => () => {
    trace.built.push(name);
    return fakeRunner(name, trace);
  };
  return { claude: factory("claude"), codex: factory("codex") };
}

function settingsFor(provider: ProviderName): AppSettings {
  return { ...DEFAULT_SETTINGS, provider };
}

const IDENTITY = (name: ProviderName): ProviderName => name;

async function drain(runner: AgentRunner): Promise<void> {
  for await (const _ of runner.start("hi", {
    conversationId: "c1",
    hostProjectRoot: "/tmp",
    getCurrentPage: () => ({ path: "unknown" }),
  })) {
    // The fake runner yields nothing; iterating is what builds the backend.
  }
}

describe("switching runner", () => {
  it("builds nothing until a turn actually needs a backend", () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    createSwitchingRunner(build(trace), settingsFor("claude"), IDENTITY);
    expect(trace.built).toEqual([]);
  });

  it("builds the selected provider once and reuses it", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("codex"),
      IDENTITY,
    );
    await drain(runner);
    await drain(runner);
    expect(trace.built).toEqual(["codex"]);
  });

  it("disposes the live backend when the provider changes", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("claude"),
      IDENTITY,
    );
    await drain(runner);
    runner.applySettings(settingsFor("codex"));
    expect(trace.disposed).toEqual(["claude"]);
    await drain(runner);
    expect(trace.built).toEqual(["claude", "codex"]);
  });

  it("keeps the live backend on an unrelated settings change", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("claude"),
      IDENTITY,
    );
    await drain(runner);
    runner.applySettings({ ...settingsFor("claude"), thinking: "high" });
    expect(trace.disposed).toEqual([]);
    expect(trace.applied).toEqual(["claude"]);
  });

  it("follows the resolver when the selected provider is unavailable", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("codex"),
      () => "claude",
    );
    await drain(runner);
    expect(trace.built).toEqual(["claude"]);
  });
});
