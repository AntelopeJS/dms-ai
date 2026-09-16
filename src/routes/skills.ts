import { Controller, Get } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import { sidecarGet } from "./proxy";

interface SkillItem {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  tags: string[];
  provenance: string;
  body: string;
}

interface SkillCatalogPayload {
  items: SkillItem[];
}

const EMPTY: SkillCatalogPayload = { items: [] };

// Read-only proxy of the sidecar's `/skills` catalog, consumed by the AI module's
// Skills page (the DmsAiSkillsView custom component).
@AuthOwnerOnly()
export class AISkillsController extends Controller(ROUTE_PREFIX) {
  @Get("/skills")
  skills(): Promise<SkillCatalogPayload> {
    return sidecarGet("/skills", EMPTY);
  }
}
