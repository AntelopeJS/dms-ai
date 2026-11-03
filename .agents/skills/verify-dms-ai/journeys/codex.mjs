import { existsSync, readFileSync, statSync } from "node:fs";
import { guarded } from "../guard.mjs";
import { ai, check, freshSidecar, list, pageHas, pick, same, sidecarLock, statusIs, text } from "../ai.mjs";

/** @typedef {import("../ai.mjs").Ctx} Ctx */

/** @param {unknown} banner */
function authorizeUrl(banner) {
  const action = list(banner, "actions").find((entry) => text(entry, "target", "type") === "external");
  return new URL(text(action, "target", "url"));
}

export const journeys = guarded([
  {
    id: "signed-out-the-banner-offers-the-sign-in-and-the-paste",
    title: "signed out, the Settings banner offers Sign in with ChatGPT toward OpenAI with this sidecar as the return address, and Paste the return address; a new sidecar makes a new attempt",
    entryPoint: "GET /ai/codex/account/banner, /modules/ai/settings",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const lock = sidecarLock(ctx);
      const banner = await ai(ctx, "banner", "GET", "/codex/account/banner");
      const url = authorizeUrl(banner.body);
      const paste = list(banner.body, "actions").find((entry) => pick(entry, "confirm") !== undefined);
      await ctx.verify("the banner", [
        same("an information banner", text(banner.body, "tone"), "info"),
        same("it sends the browser to OpenAI", [url.origin, url.pathname], ["https://auth.openai.com", "/api/accounts/authorize"]),
        same("in a new tab", pick(list(banner.body, "actions")[0], "target", "newTab"), true),
        same("the return address is this sidecar's callback on loopback", url.searchParams.get("redirect_uri"), `http://127.0.0.1:${lock?.port}/auth/chatgpt/callback`),
        same("a code flow with a challenge", [url.searchParams.get("response_type"), url.searchParams.get("code_challenge_method")], ["code", "S256"]),
        check("with a secret state", (url.searchParams.get("state") ?? "").length >= 16, url.searchParams.get("state")),
        same("it asks no API key scope", url.searchParams.get("scope")?.includes("api.") ?? false, false),
        same("the paste action asks for the whole address", [pick(paste, "confirm", "fields") !== undefined, text(list(pick(paste, "confirm", "fields"))[0], "id")], [true, "url"]),
      ]);
      await ai(ctx, "restart", "POST", "/sidecar/restart");
      await statusIs(ctx, (status) => text(status, "status") === "ready", 60_000);
      const again = authorizeUrl((await ai(ctx, "banner after a restart", "GET", "/codex/account/banner")).body);
      await ctx.verify("another sidecar", [check("a new state", again.searchParams.get("state") !== url.searchParams.get("state"), again.searchParams.get("state")), check("a new challenge", again.searchParams.get("code_challenge") !== url.searchParams.get("code_challenge"), "")]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/ai/settings");
      await ctx.verify("the page", [
        pageHas(tab, "the title", /Run Codex on your ChatGPT plan/),
        tab.visible({ role: "button", name: "Sign in with ChatGPT" }),
        tab.visible({ role: "button", name: "Paste the return address" }),
        pageHas(tab, "no email shown", /Codex runs on the ChatGPT plan of/, false),
      ]);
    },
  },
  {
    id: "a-pasted-address-is-checked-before-anything-is-stored",
    title: "a pasted return address that is not the sidecar's callback, has no code, or carries a state the sidecar did not issue is refused with the reason, and the account stays signed out",
    entryPoint: "POST /ai/codex/callback, POST /ai/codex/logout",
    async run(/** @type {Ctx} */ ctx) {
      await freshSidecar(ctx);
      const lock = sidecarLock(ctx);
      const attempts = [
        ["not an address", "garbage"],
        ["an address elsewhere", "https://example.org/auth/chatgpt/callback?code=abc&state=x"],
        ["the callback without a code", `http://127.0.0.1:${lock?.port}/auth/chatgpt/callback?state=x`],
        ["a state nobody issued", `http://127.0.0.1:${lock?.port}/auth/chatgpt/callback?code=abc&state=not-issued`],
        ["an error from OpenAI", `http://127.0.0.1:${lock?.port}/auth/chatgpt/callback?error=access_denied`],
      ];
      const results = [];
      for (const [label, url] of attempts) {
        const answer = await ai(ctx, `paste ${label}`, "POST", "/codex/callback", { body: { url } });
        results.push([label, answer.status, text(answer.body, "message")]);
      }
      await ctx.verify("every bad address", [
        same("is refused 4xx", results.filter(([, status]) => status === null || status < 400 || status >= 500), []),
        same("with a message", results.filter(([, , message]) => message === ""), []),
        same("the first says what to paste", results[0][2], "Paste the whole address of the page OpenAI sent you to, starting with http://127.0.0.1."),
      ]);
      const authFile = `${ctx.state.home}/.config/dms-ai/chatgpt-auth.json`;
      const banner = await ai(ctx, "banner", "GET", "/codex/account/banner");
      const logout = await ai(ctx, "sign out while signed out", "POST", "/codex/logout");
      const settings = await ai(ctx, "settings", "GET", "/settings");
      await ctx.verify("still signed out", [
        same("the banner offers the sign-in", text(banner.body, "title"), "$dms_ai.settings.chatgpt.signed_out.title"),
        same("signing out answers revoked", [logout.status, pick(logout.body, "isRevoked")], [200, true]),
        same("Codex stays unavailable", pick(settings.body, "providers", "codex", "available"), false),
        same("the sign-in file holds the host identity and no token", existsSync(authFile) ? Object.keys(JSON.parse(readFileSync(authFile, "utf8"))).sort() : [], ["hostId", "savedAt"]),
        same("and is readable by its owner only (mode 0600)", existsSync(authFile) ? (statSync(authFile).mode & 0o777).toString(8) : "0600", "600"),
      ]);
    },
  },
]);
