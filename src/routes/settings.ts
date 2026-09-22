import { Controller, Get, JSONBody, Put } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import { sidecarGet, sidecarPut } from "./proxy";

type ProviderName = "claude" | "codex";

interface ProviderAvailability {
  available: boolean;
  reason?: string;
}

// Typed subset of the sidecar AppSettings shape, plus the read-only
// capabilities it answers with: which providers this install can drive, and
// whether the Builder is loaded.
interface AiSettings {
  provider: ProviderName;
  mode: "normal" | "acceptEdits" | "plan" | "auto";
  thinking: "off" | "low" | "medium" | "high";
  generationMode: "safe" | "vibe";
  allowLocalSkills: boolean;
  builderAvailable: boolean;
  providers: Record<ProviderName, ProviderAvailability>;
}

// Served when the sidecar is unreachable, so the admin page renders instead of
// failing: nothing is selectable until the real answer arrives.
const DEFAULT_SETTINGS: AiSettings = {
  provider: "claude",
  mode: "normal",
  thinking: "medium",
  generationMode: "safe",
  allowLocalSkills: false,
  builderAvailable: false,
  providers: { claude: { available: true }, codex: { available: false } },
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
