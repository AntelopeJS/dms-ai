import {
  Context,
  Controller,
  Get,
  type HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { relayChatboxFile } from "../chatbox/passthrough";
import {
  CHATBOX_ASSET_ROUTE,
  CHATBOX_INDEX_PATH,
  CHATBOX_INDEX_ROUTE,
  CHATBOX_PATH_PARAM,
  CHATBOX_ROUTE_PREFIX,
} from "../constants/chatbox";

/**
 * The chat document and its assets, relayed from the sidecar's static server so
 * the iframe loads from the dashboard's own origin.
 */
@AuthOwnerOnly()
export class AIChatboxController extends Controller(CHATBOX_ROUTE_PREFIX) {
  @Get(CHATBOX_INDEX_ROUTE)
  document(@Context() ctx: RequestContext): Promise<HTTPResult | undefined> {
    return relayChatboxFile(ctx, CHATBOX_INDEX_PATH);
  }

  @Get(CHATBOX_ASSET_ROUTE)
  asset(
    @Context() ctx: RequestContext,
    @Parameter(CHATBOX_PATH_PARAM, "param") path: string,
  ): Promise<HTTPResult | undefined> {
    return relayChatboxFile(ctx, `/${path}`);
  }
}
