import { Controller, Get, HTTPResult } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import {
  ensureSidecarRunning,
  getSidecarClientToken,
  getSidecarPort,
  hasSidecarGivenUp,
  isSidecarDisabled,
  isSidecarRunning,
} from "../lifecycle/spawn-sidecar";

@AuthOwnerOnly()
export class AISidecarInfoController extends Controller(ROUTE_PREFIX) {
  @Get("/sidecar-info")
  async sidecarInfo() {
    // Reviving here makes navigation transparently respawn the sidecar after
    // its idle shutdown, so the overlay reappears on the same page load.
    await ensureSidecarRunning();
    return HTTPResult.withHeaders(
      {
        port: getSidecarPort(),
        clientToken: getSidecarClientToken(),
        isRunning: isSidecarRunning(),
        hasGivenUp: hasSidecarGivenUp(),
        disabled: isSidecarDisabled(),
      },
      { "Cache-Control": "no-store" },
    );
  }
}
