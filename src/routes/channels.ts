import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Post,
  RawBody,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { authorizeAssistantUser } from "../assistant/permission";
import { issueGrant, requestSessionId } from "../assistant/grants";
import { openChannel, postChannelMessage } from "../channels/channel-service";
import { MessageBudget } from "../channels/message-budget";
import {
  CHANNEL_EVENTS_ROUTE,
  CHANNEL_MESSAGE_MAX_BYTES,
  CHANNEL_MESSAGES_ROUTE,
  CHANNEL_ROUTE_PREFIX,
  CONNECTION_ID_PARAM,
} from "../constants/channels";
import { actorName } from "./actor";

/**
 * The browser's way to the sidecar: one event stream per tab to receive, a
 * POST per message to send. Both go through the DMS frontend server, which only
 * relays HTTP, while the sidecar keeps its loopback bind and its WebSocket
 * protocol. Open to every signed-in user holding the assistant permission in
 * their tenant; each stream carries a data grant for that user alone.
 */
export class AIChannelController extends Controller(CHANNEL_ROUTE_PREFIX) {
  @Get(CHANNEL_EVENTS_ROUTE)
  async events(
    @Context() ctx: RequestContext,
    @AuthUser() user: User,
  ): Promise<HTTPResult | undefined> {
    const { tenantId, modes } = await authorizeAssistantUser(ctx, user);
    return openChannel(ctx, {
      userId: user._id,
      name: actorName(user),
      tenantId,
      isOwner: user.owner === true,
      modes,
      grant: issueGrant({
        userId: user._id,
        tenantId,
        sessionId: requestSessionId(ctx),
      }),
    });
  }

  @Post(CHANNEL_MESSAGES_ROUTE)
  async messages(
    @Context() ctx: RequestContext,
    @Parameter(CONNECTION_ID_PARAM, "param") connectionId: string,
    @MessageBudget() _budget: void,
    @RawBody(CHANNEL_MESSAGE_MAX_BYTES) body: Buffer,
    @AuthUser() user: User,
  ): Promise<HTTPResult> {
    await authorizeAssistantUser(ctx, user);
    return postChannelMessage(connectionId, user._id, body);
  }
}
