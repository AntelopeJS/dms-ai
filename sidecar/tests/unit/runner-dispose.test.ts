import { describe, expect, it } from "vitest";
import type {
  AgentProvider,
  ProviderSession,
  ProviderSessionContext,
} from "../../src/agent/provider.js";
import { type AgentRunner, createAgentRunner } from "../../src/agent/runner.js";
import { RUNNER_CLOSED_MESSAGE } from "../../src/constants/agent.js";
import { UNKNOWN_PAGE_PATH } from "../../src/constants/host-state.js";
import {
  type Deferred,
  defer,
  flushCallbacks,
  watchSettle,
} from "../helpers/deferred.js";

interface FakeSession {
  teardown: Deferred;
  /** What a backend does when its stream ends: it tears itself down. */
  endOnItsOwn: () => void;
}

function openFakeSession(
  ctx: ProviderSessionContext,
  opened: FakeSession[],
): ProviderSession {
  const teardown = defer();
  let disposal: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposal !== null) return disposal;
    disposal = teardown.promise;
    ctx.onDisposed(disposal);
    return disposal;
  };
  opened.push({ teardown, endOnItsOwn: () => void dispose() });
  return {
    runTurn: async function* () {},
    interrupt: () => {},
    dispose,
  };
}

function fakeProvider(opened: FakeSession[]): AgentProvider {
  return {
    createSession: async (ctx) => openFakeSession(ctx, opened),
  };
}

async function openConversation(
  runner: AgentRunner,
  conversationId: string,
): Promise<void> {
  for await (const _ of runner.start("hello", {
    conversationId,
    hostProjectRoot: "/tmp",
    getCurrentPage: () => ({ path: UNKNOWN_PAGE_PATH }),
  })) {
    // The fake yields nothing; iterating is what opens the session.
  }
}

describe("runner teardown", () => {
  it("resolves dispose only once every live session is released", async () => {
    const opened: FakeSession[] = [];
    const runner = createAgentRunner(fakeProvider(opened));
    await openConversation(runner, "conv-a");
    await openConversation(runner, "conv-b");

    const disposal = watchSettle(runner.dispose());
    opened[0]?.teardown.resolve();
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(false);

    opened[1]?.teardown.resolve();
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(true);
  });

  // Nothing holds such a session any more, which is exactly why a shutdown
  // would otherwise race whatever its backend is still stopping.
  it("also waits for a session that had already torn itself down", async () => {
    const opened: FakeSession[] = [];
    const runner = createAgentRunner(fakeProvider(opened));
    await openConversation(runner, "conv-a");
    opened[0]?.endOnItsOwn();

    const disposal = watchSettle(runner.dispose());
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(false);

    opened[0]?.teardown.resolve();
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(true);
  });

  it("resolves a single conversation's dispose with its own teardown", async () => {
    const opened: FakeSession[] = [];
    const runner = createAgentRunner(fakeProvider(opened));
    await openConversation(runner, "conv-a");

    const disposal = watchSettle(runner.disposeSession("conv-a"));
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(false);

    opened[0]?.teardown.resolve();
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(true);
  });

  it("refuses to open a session once disposed", async () => {
    const opened: FakeSession[] = [];
    const runner = createAgentRunner(fakeProvider(opened));
    await runner.dispose();

    await expect(openConversation(runner, "conv-a")).rejects.toThrow(
      RUNNER_CLOSED_MESSAGE,
    );
    expect(opened).toEqual([]);
  });

  it("disposes of a session still opening when the runner is disposed, and waits for it", async () => {
    const opened: FakeSession[] = [];
    const opening = defer();
    const provider: AgentProvider = {
      createSession: async (ctx) => {
        await opening.promise;
        return openFakeSession(ctx, opened);
      },
    };
    const runner = createAgentRunner(provider);
    const turn = openConversation(runner, "conv-a").catch(
      (error: unknown) => error,
    );
    await flushCallbacks();

    const disposal = watchSettle(runner.dispose());
    opening.resolve();
    await flushCallbacks();
    expect(opened).toHaveLength(1);
    expect(disposal.isSettled()).toBe(false);

    opened[0]?.teardown.resolve();
    await flushCallbacks();
    expect(disposal.isSettled()).toBe(true);
    expect(String(await turn)).toContain(RUNNER_CLOSED_MESSAGE);
  });
});
