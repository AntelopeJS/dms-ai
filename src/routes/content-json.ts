import type {
  BannerContent,
  KeyValueListItem,
} from "@antelopejs/interface-dms/base";
import { isJsonBody, type JsonBody } from "../sidecar/json-body";

/**
 * What dms-ai answers in interface-dms's shapes, which do not promise JSON:
 * a banner action may open a component whose serialized props are open.
 */
export type DmsContent = BannerContent | { items: KeyValueListItem[] };

/**
 * The JSON value `JSON.stringify` writes for `content`, so an answer holding
 * it serializes byte for byte as one holding the content.
 */
export function contentJson(content: DmsContent): JsonBody {
  const json: unknown = JSON.parse(JSON.stringify(content));
  if (!isJsonBody(json)) {
    throw new TypeError("dms content did not serialize to JSON");
  }
  return json;
}
