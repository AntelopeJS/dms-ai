import { Controller, Get, HTTPResult } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
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
 * shutdown and the panel reappears on the same page load.
 */
@AuthOwnerOnly()
export class AISidecarInfoController extends Controller(ROUTE_PREFIX) {
  @Get("/sidecar-info")
  async sidecarInfo() {
    await ensureSidecarRunning();
    return HTTPResult.withHeaders(
      {
        isRunning: isSidecarRunning(),
        hasGivenUp: hasSidecarGivenUp(),
        disabled: isSidecarDisabled(),
      },
      { "Cache-Control": "no-store" },
    );
  }
}
