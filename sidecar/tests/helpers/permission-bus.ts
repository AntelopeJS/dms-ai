import {
  type BusOptions,
  createPermissionBus,
  type PendingRequest,
  type PermissionBus,
  type PermissionDecisionRecord,
  type PermissionPolicy,
} from "../../src/agent/permission-bus.js";

export const FAST_TIMEOUT_MS = 50;
export const TEST_PROJECT_ROOT = "/tmp/dms-ai-test-project";
const POLL_MS = 5;
const WAIT_LIMIT_MS = 2000;

export interface TestBus {
  bus: PermissionBus;
  prompts: PendingRequest[];
  decisions: PermissionDecisionRecord[];
  denyAlls: string[];
  policy: PermissionPolicy;
  /** Resolves once `count` prompts reached the chat. */
  waitForPrompts: (count: number) => Promise<PendingRequest[]>;
}

export interface TestBusOptions {
  timeoutMs?: number;
  policy?: Partial<PermissionPolicy>;
  extra?: Partial<BusOptions>;
}

export function buildPolicy(overrides: Partial<PermissionPolicy> = {}) {
  return {
    hostProjectRoot: TEST_PROJECT_ROOT,
    isFullAuto: false,
    timeoutMs: FAST_TIMEOUT_MS,
    alwaysAskDependencies: true,
    alwaysAskBlockRemoval: true,
    ...overrides,
  };
}

export function createTestBus(options: TestBusOptions = {}): TestBus {
  const prompts: PendingRequest[] = [];
  const decisions: PermissionDecisionRecord[] = [];
  const denyAlls: string[] = [];
  const policy = buildPolicy(options.policy);
  const bus = createPermissionBus({
    getPolicy: () => policy,
    onPromptChat: (event) => {
      prompts.push(event);
    },
    onDecided: (record) => {
      decisions.push(record);
    },
    onDenyAll: (conversationId) => {
      denyAlls.push(conversationId);
    },
    timeoutMs: options.timeoutMs ?? FAST_TIMEOUT_MS,
    ...options.extra,
  });
  const waitForPrompts = async (count: number) => {
    const started = Date.now();
    while (prompts.length < count) {
      if (Date.now() - started > WAIT_LIMIT_MS) {
        throw new Error(`expected ${count} prompts, saw ${prompts.length}`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return prompts;
  };
  return { bus, prompts, decisions, denyAlls, policy, waitForPrompts };
}
