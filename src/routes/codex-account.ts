import { Controller, Get, HTTPResult, Post } from "@antelopejs/interface-api";
import type {
  BannerButtonAction,
  BannerContent,
} from "@antelopejs/interface-dms/base";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { I18N_SECTIONS } from "../constants/i18n";
import { ROUTE_PREFIX } from "../constants/module";
import { PAGE_ROUTES } from "../constants/pages";
import { requestSidecar } from "../sidecar";
import { i18nKey } from "../vocabulary";
import { bannerAnswer } from "./banner";
import { relay } from "./sidecar-results";

const ACCOUNT_PATH = "/codex/account";
const LOGOUT_PATH = "/codex/logout";
const NO_STORE = { "Cache-Control": "no-store" };

/** What the sidecar says about the ChatGPT account Codex runs on. */
interface CodexAccount {
  isSignedIn: boolean;
  email?: string;
  /** The sidecar's loopback sign-in link, when no account is signed in. */
  loginUrl?: string;
}

function text(...segments: string[]): string {
  return i18nKey(I18N_SECTIONS.SETTINGS, "chatgpt", ...segments);
}

const SIGN_OUT_ACTION: BannerButtonAction = {
  label: text("signed_in", "action"),
  icon: "i-ph-sign-out",
  color: "neutral",
  confirm: {
    title: text("sign_out_confirm", "title"),
    description: text("sign_out_confirm", "description"),
    confirmLabel: text("signed_in", "action"),
    color: "error",
  },
  target: {
    type: "api",
    url: PAGE_ROUTES.CODEX_LOGOUT,
    method: "POST",
    successMessage: text("signed_out_toast"),
  },
};

function signedInBanner(account: CodexAccount): BannerContent {
  return {
    tone: "success",
    size: "sm",
    icon: "i-ph-open-ai-logo",
    title: {
      key: text("signed_in", "title"),
      params: { email: account.email ?? "" },
    },
    description: text("signed_in", "description"),
    actions: [SIGN_OUT_ACTION],
  };
}

// The link is the sidecar's own loopback server: OpenAI only redirects back
// to 127.0.0.1, so it works from a browser on the machine running the DMS.
function signedOutBanner(loginUrl: string): BannerContent {
  return {
    tone: "info",
    size: "sm",
    icon: "i-ph-open-ai-logo",
    title: text("signed_out", "title"),
    description: text("signed_out", "description"),
    actions: [
      {
        label: text("signed_out", "action"),
        icon: "i-ph-sign-in",
        target: { type: "external", url: loginUrl, newTab: true },
      },
    ],
  };
}

function accountBanner(account: CodexAccount): BannerContent | null {
  if (account.isSignedIn) return signedInBanner(account);
  return account.loginUrl === undefined
    ? null
    : signedOutBanner(account.loginUrl);
}

/**
 * Settings' ChatGPT account: the banner offering to sign in or out, and the
 * sign-out it runs. No banner while the sidecar does not answer: the Overview
 * already says it is down.
 */
@AuthOwnerOnly()
export class AICodexAccountController extends Controller(ROUTE_PREFIX) {
  @Get(`${ACCOUNT_PATH}/banner`)
  async banner(): Promise<HTTPResult> {
    try {
      const response = await requestSidecar(ACCOUNT_PATH);
      const content = response.isOk
        ? accountBanner(response.body as CodexAccount)
        : null;
      return HTTPResult.withHeaders(bannerAnswer(content), NO_STORE);
    } catch {
      return HTTPResult.withHeaders(bannerAnswer(null), NO_STORE);
    }
  }

  @Post(LOGOUT_PATH)
  logout(): Promise<unknown> {
    return relay(LOGOUT_PATH, (body: unknown) => body, { method: "POST" });
  }
}
