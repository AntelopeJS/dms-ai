import { describe, expect, it } from "vitest";
import { resolveClaudeBinary } from "../../src/providers/claude/resolve-binary.js";
import {
  manifestBesideEntry,
  manifestBesideFile,
  manifestOf,
} from "../helpers/package-manifests.js";

describe("the Claude Code CLI the Agent SDK is pointed at", () => {
  const binary = resolveClaudeBinary() ?? "";
  const claudeCode = manifestOf("@anthropic-ai/claude-code");

  it("is the native binary of the claude-code dependency, not the SDK's bundled one", () => {
    expect(binary).toContain("@anthropic-ai/claude-code-");
    expect(binary).not.toContain("claude-agent-sdk");
  });

  it("is built from the installed claude-code version", () => {
    expect(manifestBesideFile(binary).version).toBe(claudeCode.version);
  });

  it("is the very version the installed Agent SDK was built for", () => {
    const agentSdk = manifestBesideEntry("@anthropic-ai/claude-agent-sdk");
    expect(claudeCode.version).toBe(agentSdk.claudeCodeVersion);
  });
});
