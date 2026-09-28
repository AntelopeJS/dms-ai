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
import { AuthOwnerOnly, AuthRawUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { openChannel, postChannelMessage } from "../channels/channel-service";
import {
  CHANNEL_EVENTS_ROUTE,
  CHANNEL_MESSAGE_MAX_BYTES,
  CHANNEL_MESSAGES_ROUTE,
  CHANNELS_PARAM,
  CHANNELS_ROUTE_PREFIX,
  CONNECTION_ID_PARAM,
} from "../constants/channels";

/**
 * The browser's way to the sidecar: one event stream to receive on several
 * channels, a POST per message to send. Both go through the DMS frontend
 * server, which only relays HTTP, while the sidecar keeps its loopback bind and
 * its WebSocket protocol.
 */
@AuthOwnerOnly()
export class AIChannelsController extends Controller(CHANNELS_ROUTE_PREFIX) {
  @Get(CHANNEL_EVENTS_ROUTE)
  events(
    @Context() ctx: RequestContext,
    @Parameter(CHANNELS_PARAM, "param") channels: string,
    @AuthRawUser() user: User,
  ): Promise<HTTPResult | undefined> {
    return openChannel(ctx, channels, user._id);
  }

  @Post(CHANNEL_MESSAGES_ROUTE)
  messages(
    @Parameter(CONNECTION_ID_PARAM, "param") connectionId: string,
    @RawBody(CHANNEL_MESSAGE_MAX_BYTES) body: Buffer,
    @AuthRawUser() user: User,
  ): Promise<HTTPResult> {
    return postChannelMessage(connectionId, user._id, body);
  }
}
