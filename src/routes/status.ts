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
import { assistantUnavailable } from "./sidecar-results";

const STATUS_PATH = "/status";
const OFFLINE_STATUS = "offline";
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
 * answer, both with the process state: the status card always has something
 * to draw, and knows whether a restart can help.
 */
async function readStatus(): Promise<HTTPResult> {
  try {
    const response = await requestSidecar(STATUS_PATH);
    const reported = response.isOk ? (response.body as object) : {};
    const status = response.isOk ? {} : { status: OFFLINE_STATUS };
    return HTTPResult.withHeaders(
      { ...status, ...reported, ...processState() },
      NO_STORE,
    );
  } catch {
    return HTTPResult.withHeaders(
      { status: OFFLINE_STATUS, ...processState() },
      NO_STORE,
    );
  }
}

/** The assistant's live status, and the way to restart it. */
@AuthOwnerOnly()
export class AIStatusController extends Controller(ROUTE_PREFIX) {
  @Get(STATUS_PATH)
  status(): Promise<HTTPResult> {
    return readStatus();
  }

  @Post("/sidecar/restart")
  async restart(): Promise<HTTPResult> {
    try {
      await restartSidecar();
    } catch {
      return assistantUnavailable();
    }
    return readStatus();
  }
}
