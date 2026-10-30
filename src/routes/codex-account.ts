import {
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Post,
} from "@antelopejs/interface-api";
import type {
  BannerButtonAction,
  BannerContent,
} from "@antelopejs/interface-dms/base";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { serializeConfirmDialog } from "@antelopejs/interface-dms/base/confirm-dialog";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";
import { I18N_SECTIONS } from "../constants/i18n";
import { ROUTE_PREFIX } from "../constants/module";
import { PAGE_ROUTES } from "../constants/pages";
import { type JsonBody, requestSidecar } from "../sidecar";
import { i18nKey } from "../vocabulary";
import { bannerAnswer } from "./banner";
import { asIs, relay } from "./sidecar-results";

const ACCOUNT_PATH = "/codex/account";
const LOGOUT_PATH = "/codex/logout";
const CALLBACK_PATH = "/codex/callback";
/** Field of the paste dialog, sent as the request body. */
const PASTED_URL_FIELD = "url";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * What the sidecar says about the ChatGPT account Codex runs on: whether one
 * is signed in, its email, and OpenAI's authorization URL for a new attempt
 * when none is.
 */
const CodexAccountSchema = z.object({
  isSignedIn: z.boolean(),
  email: z.string().optional(),
  loginUrl: z.string().optional(),
});

type CodexAccount = z.infer<typeof CodexAccountSchema>;

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

/**
 * OpenAI only redirects back to 127.0.0.1. On the machine running the DMS that
 * is the sidecar, and the sign-in completes by itself; anywhere else the page
 * fails to load, and its address is pasted here instead.
 */
const PASTE_ACTION: BannerButtonAction = {
  label: text("paste", "action"),
  icon: "i-ph-clipboard-text",
  color: "neutral",
  confirm: serializeConfirmDialog({
    title: text("paste", "title"),
    description: text("paste", "description"),
    icon: "i-ph-clipboard-text",
    confirmLabel: text("paste", "confirm"),
    fields: [
      {
        id: PASTED_URL_FIELD,
        label: text("paste", "field"),
        type: new DefaultDataTypes.StringType({
          placeholder: "http://127.0.0.1:…/auth/chatgpt/callback?code=…",
        }),
        required: true,
      },
    ],
  }),
  target: {
    type: "api",
    url: PAGE_ROUTES.CODEX_CALLBACK,
    method: "POST",
    successMessage: text("paste", "success"),
  },
};

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
      PASTE_ACTION,
    ],
  };
}

function accountBanner(account: CodexAccount): BannerContent | null {
  if (account.isSignedIn) return signedInBanner(account);
  return account.loginUrl === undefined
    ? null
    : signedOutBanner(account.loginUrl);
}

/** What the sign-in form posts: the address the browser landed on. */
interface PastedCallbackBody {
  [PASTED_URL_FIELD]?: string;
}

/**
 * Settings' ChatGPT account: the banner offering to sign in or out, the
 * pasted return address that completes a remote sign-in, and the sign-out. No banner while the sidecar does not answer: the Overview
 * already says it is down.
 */
@AuthOwnerOnly()
export class AICodexAccountController extends Controller(ROUTE_PREFIX) {
  @Get(`${ACCOUNT_PATH}/banner`)
  async banner(): Promise<HTTPResult> {
    try {
      const response = await requestSidecar(ACCOUNT_PATH);
      const account = CodexAccountSchema.safeParse(response.body);
      const content =
        response.isOk && account.success ? accountBanner(account.data) : null;
      return HTTPResult.withHeaders(bannerAnswer(content), NO_STORE);
    } catch {
      return HTTPResult.withHeaders(bannerAnswer(null), NO_STORE);
    }
  }

  @Post(CALLBACK_PATH)
  finishSignIn(
    @JSONBody() body?: PastedCallbackBody,
  ): Promise<JsonBody | HTTPResult | undefined> {
    return relay(CALLBACK_PATH, asIs, {
      method: "POST",
      body: { url: body?.[PASTED_URL_FIELD] },
    });
  }

  @Post(LOGOUT_PATH)
  logout(): Promise<JsonBody | HTTPResult | undefined> {
    return relay(LOGOUT_PATH, asIs, { method: "POST" });
  }
}
