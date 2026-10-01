import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * AI Settings — reached from the chat panel's cogwheel (/modules/ai/settings).
 * Custom Vue view: the provider (Claude or Codex, each on its default model),
 * the generation mode, the operating mode (normal / accept edits / plan /
 * auto), thinking and the local skills, persisted to the sidecar via
 * `/ai/settings`.
 */
@RegisterPage()
export class AISettingsPage extends PageController(
  "settings",
  {
    displayName: "Settings",
    description: "AI assistant configuration",
    icon: "i-ph-gear-six",
    module: "ai",
    order: 3,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsAiSettingsView").meta({
    name: "Settings",
    icon: "i-ph-gear-six",
  });
}
