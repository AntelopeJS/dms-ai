import { guarded } from "../guard.mjs";
import { ai, check, freshSidecar, pageHas, same, text } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

export const journeys = guarded([
  {
    id: "a-production-dashboard-shows-no-assistant",
    title: "the production dashboard `dms-control` runs shows no Assistant launcher, no side panel and no palette assistant, whatever the shortcut, while the backend's sidecar runs and the pages work",
    entryPoint: "the dashboard header, Ctrl+Shift+K, Ctrl+K, /ai/sidecar-info",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const status = await ai(ctx, "status", "GET", "/status");
      const tab = await ctx.tab();
      await tab.signIn("admin");
      for (const path of ["/home", "/modules/ai/overview", "/verify-plain"]) {
        await tab.goto(path);
        await tab.page.waitForTimeout(3000);
        await tab.page.keyboard.press("Control+Shift+K");
        await tab.page.waitForTimeout(1500);
        const launcher = await tab.page.getByRole("button", { name: /^(Open |Close )?(the )?Assistant$/ }).count();
        const panel = await tab.page.getByPlaceholder(/Ask|message/i).count();
        const starters = await tab.page.getByText("Explain how this project is organised").count();
        await ctx.verify(`${path}`, [check("no Assistant button in the header", launcher === 0, launcher), check("no composer after the shortcut", panel === 0, panel), check("no starter prompt", starters === 0, starters)]);
      }
      await tab.page.keyboard.press("Control+K");
      await tab.page.waitForTimeout(1500);
      await ctx.verify("the command palette", [pageHas(tab, "has no Assistant group", /Open the assistant|Review approvals/, false)]);
      await ctx.verify("the backend side", [same("the sidecar runs for a probe all the same", text(status.body, "status"), "ready")]);
    },
  },
]);
