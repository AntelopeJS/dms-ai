import { Controller, Get } from "@antelopejs/interface-api";
import { MODULE_ID, ROUTE_PREFIX } from "../constants/module";

export class AIHealthController extends Controller(ROUTE_PREFIX) {
  @Get("/health")
  health() {
    return { ok: true, module: MODULE_ID };
  }
}
