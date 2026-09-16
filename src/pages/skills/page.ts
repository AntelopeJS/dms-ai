import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";

/**
 * AI Skills — read-only catalog of the SKILL.md files loaded into the agent,
 * contributed by loaded modules (and the machine-local source when enabled).
 * A custom Vue view fed by `/ai/skills`: a flat card list sorted by provenance,
 * a search box, and a detail drawer that shows the SKILL.md body. TableView is a
 * DB-backed component, so a CustomComponent is the right fit for sidecar-sourced,
 * non-persisted data (mirrors the Settings/Activity views).
 */
@RegisterPage()
export class AISkillsPage extends PageController(
  "skills",
  {
    displayName: "Skills",
    description: "Skills loaded into the AI agent",
    icon: "i-ph-sparkle",
    module: "ai",
    order: 2,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsAiSkillsView").meta({
    name: "Skills",
    icon: "i-ph-sparkle",
  });
}
