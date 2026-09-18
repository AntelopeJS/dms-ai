import { describe, expect, it } from "vitest";
import type { AgentRunner } from "../../src/agent/runner.js";
import { createSwitchingRunner } from "../../src/agent/switching-runner.js";
import { PROVIDER_LABELS } from "../../src/constants/providers.js";
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

// Availability is machine-dependent (installed packages, environment), so the
// switching logic is driven by an explicit verdict here.
const ALL_AVAILABLE = (): string | undefined => undefined;
const CODEX_REASON = "no API key";
const CODEX_UNAVAILABLE = (name: ProviderName): string | undefined =>
  name === "codex" ? CODEX_REASON : undefined;

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
    createSwitchingRunner(build(trace), settingsFor("claude"), ALL_AVAILABLE);
    expect(trace.built).toEqual([]);
  });

  it("builds the selected provider once and reuses it", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("codex"),
      ALL_AVAILABLE,
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
      ALL_AVAILABLE,
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
      ALL_AVAILABLE,
    );
    await drain(runner);
    runner.applySettings({ ...settingsFor("claude"), thinking: "high" });
    expect(trace.disposed).toEqual([]);
    expect(trace.applied).toEqual(["claude"]);
  });

  // The selected provider is never swapped for another one: someone who picked
  // OpenAI may have picked it so their code does not reach Anthropic.
  it("refuses the turn when the selected provider cannot run", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("codex"),
      CODEX_UNAVAILABLE,
    );
    await expect(drain(runner)).rejects.toThrow(CODEX_REASON);
    expect(trace.built).toEqual([]);
  });

  it("names the provider that was asked for, so the chat can act on it", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("codex"),
      CODEX_UNAVAILABLE,
    );
    await expect(drain(runner)).rejects.toThrow(PROVIDER_LABELS.codex);
  });

  it("still drives an available provider while another one is not", async () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("claude"),
      CODEX_UNAVAILABLE,
    );
    await drain(runner);
    expect(trace.built).toEqual(["claude"]);
  });

  // activate() throws before a backend exists, so a stop or a close arriving
  // after a refused turn must not fail on a runner that was never built.
  it("stays quiet on interrupt and dispose when nothing was ever built", () => {
    const trace: Trace = { built: [], disposed: [], applied: [] };
    const runner = createSwitchingRunner(
      build(trace),
      settingsFor("codex"),
      CODEX_UNAVAILABLE,
    );
    expect(() => runner.interruptSession("c1")).not.toThrow();
    expect(() => runner.disposeSession("c1")).not.toThrow();
    expect(() => runner.dispose()).not.toThrow();
  });
});
