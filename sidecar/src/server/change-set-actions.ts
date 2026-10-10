import type { ChangeSetActionMsgType } from "../protocol/messages.js";
import type { ChangeSetRecord } from "../state/types.js";
import { broadcastConversationList } from "./chat-events.js";
import type { SidecarServices } from "./services.js";
import { sendChangeSet } from "./turns.js";

export type ChangeSetAction = ChangeSetActionMsgType["action"];

export interface ChangeSetActionRequest {
  changeSetId: string;
  action: ChangeSetAction;
  includeLater?: boolean;
}

type ActionRunner = (
  services: SidecarServices,
  request: ChangeSetActionRequest,
  actor: string | undefined,
) => Promise<ChangeSetRecord[]>;

const ACTION_RUNNERS: Record<ChangeSetAction, ActionRunner> = {
  undo: (services, request, actor) =>
    services.checkpoints.undo(
      request.changeSetId,
      request.includeLater === true,
      actor,
    ),
  redo: (services, request, actor) =>
    services.checkpoints.redo(request.changeSetId, actor),
};

/**
 * Undoes or redoes a change set (and, for an undo, the later ones that
 * conflict with it when asked), then tells every chat showing an affected
 * conversation. Answers the ids it changed.
 */
export async function handleChangeSetAction(
  services: SidecarServices,
  request: ChangeSetActionRequest,
  actor: string | undefined,
): Promise<string[]> {
  const changed = await ACTION_RUNNERS[request.action](
    services,
    request,
    actor,
  );
  for (const record of changed) sendChangeSet(services, record);
  broadcastConversationList(services);
  return changed.map((record) => record.id);
}
