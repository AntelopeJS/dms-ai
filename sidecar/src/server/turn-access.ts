import { BUILDER_REFUSED_MESSAGE } from "../constants/analyst.js";
import { mayRunBuilder } from "./access.js";
import type { SidecarServices } from "./services.js";

/** Whether the conversation's next turn runs as Analyst. */
export function isAnalystTurn(
  services: SidecarServices,
  conversationId: string,
): boolean {
  return (
    services.conversationModes.state(conversationId).assistant === "analyst"
  );
}

/**
 * Refuses a Builder turn the asker may not run: in production nobody may, and
 * in development only the users the backend lets.
 */
function assertTurnAllowed(
  services: SidecarServices,
  conversationId: string,
): void {
  if (isAnalystTurn(services, conversationId)) return;
  const scope = {
    actor: services.turnActors.get(conversationId) ?? null,
    isDevelopment: services.isDevelopment,
  };
  if (!mayRunBuilder(scope)) throw new Error(BUILDER_REFUSED_MESSAGE);
}

function claimConversation(
  services: SidecarServices,
  conversationId: string,
): void {
  const actor = services.turnActors.get(conversationId);
  if (actor === undefined) return;
  services.conversationStore.claim(conversationId, {
    userId: actor.userId,
    tenantId: actor.tenantId,
  });
}

/**
 * Lets a turn start: refuses a Builder turn its asker may not run, then
 * records the asker as the conversation's owner if it has none yet.
 */
export function admitTurn(
  services: SidecarServices,
  conversationId: string,
): void {
  assertTurnAllowed(services, conversationId);
  claimConversation(services, conversationId);
}
