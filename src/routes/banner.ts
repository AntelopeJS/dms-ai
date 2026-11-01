import { HTTPResult } from "@antelopejs/interface-api";
import type { BannerContent } from "@antelopejs/interface-dms/base";
import { HTTP_STATUS } from "../constants/http";
import type { JsonBody } from "../sidecar/json-body";
import { contentJson } from "./content-json";

/**
 * What a `Banner` block's `fetchUrl` answers: its content, or a 204 when
 * there is nothing to tell, so the block draws nothing.
 */
export function bannerAnswer(
  content: BannerContent | null,
): JsonBody | HTTPResult {
  return content === null
    ? new HTTPResult(HTTP_STATUS.NO_CONTENT)
    : contentJson(content);
}
