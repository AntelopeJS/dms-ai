import { Controller, Get, HTTPResult, Post } from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import {
  hasSidecarGivenUp,
  isSidecarDisabled,
  isSidecarRunning,
  restartSidecar,
} from "../lifecycle/spawn-sidecar";
import { requestSidecar } from "../sidecar";
import type { AssistantStatus } from "../types";
import { bannerAnswer } from "./banner";
import { assistantUnavailable } from "./sidecar-results";
import { OFFLINE_STATUS, statusBanner, statusFacts } from "./status-shapes";

const STATUS_PATH = "/status";
const NO_STORE = { "Cache-Control": "no-store" };

/** What the backend knows of the sidecar process, beside what it says itself. */
interface ProcessState {
  isRunning: boolean;
  hasGivenUp: boolean;
  disabled: boolean;
}

function processState(): ProcessState {
  return {
    isRunning: isSidecarRunning(),
    hasGivenUp: hasSidecarGivenUp(),
    disabled: isSidecarDisabled(),
  };
}

/**
 * The sidecar's own status, or `{ status: "offline" }` when it does not
 * answer, both with the process state: the Overview always has something to
 * draw, and knows whether a restart can help.
 */
async function readStatus(): Promise<AssistantStatus> {
  try {
    const response = await requestSidecar(STATUS_PATH);
    const reported = response.isOk ? (response.body as object) : {};
    const status = response.isOk ? {} : { status: OFFLINE_STATUS };
    return { ...status, ...reported, ...processState() } as AssistantStatus;
  } catch {
    return { status: OFFLINE_STATUS, ...processState() };
  }
}

function fresh(body: unknown): HTTPResult {
  return HTTPResult.withHeaders(body, NO_STORE);
}

/**
 * The assistant's live status, the Overview's status rows and banner drawn
 * from it, and the way to restart it.
 */
@AuthOwnerOnly()
export class AIStatusController extends Controller(ROUTE_PREFIX) {
  @Get(STATUS_PATH)
  async status(): Promise<HTTPResult> {
    return fresh(await readStatus());
  }

  @Get(`${STATUS_PATH}/facts`)
  async facts(): Promise<HTTPResult> {
    return fresh({ items: statusFacts(await readStatus()) });
  }

  @Get(`${STATUS_PATH}/banner`)
  async banner(): Promise<HTTPResult> {
    return fresh(bannerAnswer(statusBanner(await readStatus())));
  }

  @Post("/sidecar/restart")
  async restart(): Promise<HTTPResult> {
    try {
      await restartSidecar();
    } catch {
      return assistantUnavailable();
    }
    return fresh(await readStatus());
  }
}
