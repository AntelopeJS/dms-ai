import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * AI Settings — reached from the chatbox cogwheel (/modules/ai/settings).
 * Custom Vue view: provider/model are locked to Claude, plus the generation
 * mode and the operating mode (normal / accept edits / plan / auto), persisted
 * to the sidecar via `/ai/settings`.
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
