import { describe, expect, it } from "vitest";
import { type JsonValue, JsonValueSchema } from "../../src/protocol/json.js";
import { buildAnalystCatalog } from "../../src/providers/codex/analyst.js";

const FORCING_MODEL = {
  slug: "gpt-forcing",
  display_name: "Forcing",
  context_window: 272_000,
  base_instructions: "You are Codex.",
  tool_mode: "code_mode_only",
  apply_patch_tool_type: "freeform",
  web_search_tool_type: "text_and_image",
  multi_agent_version: "v2",
  experimental_supported_tools: ["send_user_message_async", "clock"],
  supports_search_tool: true,
};

const PLAIN_MODEL = {
  slug: "gpt-plain",
  tool_mode: null,
  multi_agent_version: null,
  apply_patch_tool_type: "freeform",
  web_search_tool_type: "text",
  experimental_supported_tools: [],
  supports_search_tool: false,
};

function transform(models: object[]): JsonValue {
  return JsonValueSchema.parse(
    JSON.parse(buildAnalystCatalog(JSON.stringify({ models }))),
  );
}

describe("the Analyst model catalog", () => {
  it("drops every key that forces a built-in tool on and keeps the rest of each model", () => {
    expect(transform([FORCING_MODEL])).toEqual({
      models: [
        {
          slug: "gpt-forcing",
          display_name: "Forcing",
          context_window: 272_000,
          base_instructions: "You are Codex.",
          experimental_supported_tools: [],
          supports_search_tool: false,
        },
      ],
    });
  });

  it("removes those keys even when they are null, which Codex would reject", () => {
    expect(transform([PLAIN_MODEL])).toEqual({
      models: [
        {
          slug: "gpt-plain",
          experimental_supported_tools: [],
          supports_search_tool: false,
        },
      ],
    });
  });

  it("transforms every model, not only the first", () => {
    expect(transform([PLAIN_MODEL, FORCING_MODEL])).toEqual({
      models: [
        expect.not.objectContaining({ tool_mode: null }),
        expect.not.objectContaining({ tool_mode: "code_mode_only" }),
      ],
    });
  });

  it("refuses output that is not a catalog rather than writing an empty one", () => {
    expect(() => buildAnalystCatalog('{"data": []}')).toThrow();
  });
});
