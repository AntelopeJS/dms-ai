import type { AgentProvider, AgentProviderOptions } from "../agent/provider.js";
import type { McpHttpRegistry } from "../mcp/http-binding.js";
import type { AiMcpServerDeps } from "../mcp/types.js";
import type { ProviderName } from "../state/types.js";

/**
 * What the sidecar's own runtime offers a provider — whichever one it is.
 *
 * Nothing here is specific to a backend: an agent that runs out of process
 * needs somewhere to keep its state and an MCP endpoint it can reach, and those
 * are the same two needs whoever answers them. A provider that runs in-process
 * ignores the lot; its MCP server reaches it through the session context.
 */
export interface ProviderHostRuntime {
  stateDir: string;
  /** Per-conversation MCP endpoints, addressed by bearer token over loopback. */
  mcpHttpRegistry: McpHttpRegistry;
  getMcpUrl: () => string;
}

/**
 * The host runtime plus the per-conversation tool deps, which only the WS layer
 * can build (AskUser has to reach the right iframe).
 */
export interface ProviderRuntime extends ProviderHostRuntime {
  createMcpDeps: (conversationId: string) => AiMcpServerDeps;
}

export interface ProviderAvailability {
  available: boolean;
  /** Why the provider is greyed out; absent when it is available. */
  reason?: string;
}

export type ProviderAvailabilityMap = Record<
  ProviderName,
  ProviderAvailability
>;

export const AVAILABLE: ProviderAvailability = { available: true };

export function unavailable(reason: string): ProviderAvailability {
  return { available: false, reason };
}

/**
 * One agent backend, declaring itself rather than being known by name.
 *
 * Adding a provider means adding a module here and a name to PROVIDER_NAMES:
 * every `Record<ProviderName, …>` then fails to compile until the new one is
 * wired, which is the checklist.
 */
export interface ProviderModule {
  name: ProviderName;
  create(
    options: AgentProviderOptions,
    runtime: ProviderRuntime,
  ): AgentProvider;
  /** Whether this install can actually drive the backend, and why not. */
  checkAvailability(): ProviderAvailability;
  /**
   * Clears what a previous sidecar left running, before anything new starts.
   * Omitted by a backend that leaves nothing behind.
   */
  reapOrphans?(stateDir: string): Promise<void>;
}
