import {
  Context,
  Controller,
  Get,
  HTTPResult,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthUser } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { authorizeAssistantUser } from "../assistant/permission";
import { ROUTE_PREFIX } from "../constants/module";
import {
  ensureSidecarRunning,
  hasSidecarGivenUp,
  isSidecarDisabled,
  isSidecarRunning,
} from "../lifecycle/spawn-sidecar";

/**
 * Status only: the port and the client credential stay on the server, since
 * the browser reaches the sidecar through the channel routes. Each probe
 * revives the sidecar, so navigation transparently respawns it after its idle
 * shutdown and the panel reappears on the same page load. Answers every user
 * allowed to chat, with the assistant modes they may run.
 */
export class AISidecarInfoController extends Controller(ROUTE_PREFIX) {
  @Get("/sidecar-info")
  async sidecarInfo(@Context() ctx: RequestContext, @AuthUser() user: User) {
    const { modes } = await authorizeAssistantUser(ctx, user);
    await ensureSidecarRunning();
    return HTTPResult.withHeaders(
      {
        isRunning: isSidecarRunning(),
        hasGivenUp: hasSidecarGivenUp(),
        disabled: isSidecarDisabled(),
        modes,
      },
      { "Cache-Control": "no-store" },
    );
  }
}
