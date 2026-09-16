import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import { sidecarGet, sidecarPut } from "./proxy";

// Typed subset of the sidecar AppSettings shape; provider/model are fixed to
// Claude for now.
interface AiSettings {
  mode: "normal" | "acceptEdits" | "plan" | "auto";
  thinking: "off" | "low" | "medium" | "high";
  generationMode: "safe" | "vibe";
  allowLocalSkills: boolean;
  builderAvailable: boolean;
}

const DEFAULT_SETTINGS: AiSettings = {
  mode: "normal",
  thinking: "medium",
  generationMode: "safe",
  allowLocalSkills: false,
  builderAvailable: false,
};

@AuthOwnerOnly()
export class AISettingsController extends Controller(ROUTE_PREFIX) {
  @Get("/settings")
  getSettings(): Promise<AiSettings> {
    return sidecarGet("/settings", DEFAULT_SETTINGS);
  }

  @Put("/settings")
  updateSettings(@JSONBody() body: unknown): Promise<AiSettings> {
    return sidecarPut("/settings", body, DEFAULT_SETTINGS);
  }
}
