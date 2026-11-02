import { describe, expect, it, vi } from "vitest";
import { describeRequest } from "../../src/agent/permission-preview.js";
import { asksBeforeBuilderCall } from "../../src/agent/tool-kinds.js";
import type { BuilderClient } from "../../src/builder/builder-client.js";
import { MCP_TOOL_NAME_PREFIX } from "../../src/constants/mcp.js";
import type { BuilderGate } from "../../src/mcp/tools/builder-gate.js";
import { gateBuilderTools } from "../../src/mcp/tools/builder-gate.js";
import { buildProjectTools } from "../../src/mcp/tools/builder-project.js";

const TOOL = "BuilderMapResources";
const PAGE = "pages.shop.shop-orders";
const INPUT = {
  module: "shop-tables",
  connection: "shop",
  resources: [
    { relation: "shop.orders", tableView: false, writable: false, fields: [] },
  ],
};

type GateArgs = Parameters<BuilderGate>[1];

interface Recorded {
  op: string;
  args: unknown[];
}

function client(calls: Recorded[], pagesToRemove: string[]): BuilderClient {
  return {
    call: async (op, args) => {
      calls.push({ op, args });
      return op === "PreviewMapResources"
        ? { ok: true, data: { pagesToRemove }, changes: [] }
        : { ok: true, data: { resources: [], leftOut: [] }, changes: [] };
    },
  };
}

function mapResources(builder: BuilderClient, gate: BuilderGate) {
  const [tool] = gateBuilderTools(
    buildProjectTools(builder, gate).filter(
      (definition) => definition.name === TOOL,
    ),
    gate,
  );
  if (!tool) throw new Error(`${TOOL} is missing`);
  return () => tool.handler(INPUT);
}

describe("BuilderMapResources asks before it removes a page", () => {
  it("asks with the pages the preview lists, then maps once approved", async () => {
    const calls: Recorded[] = [];
    const asked: GateArgs[] = [];
    const gate: BuilderGate = async (_tool, args) => {
      asked.push(args);
      return { isAllowed: true };
    };
    await mapResources(client(calls, [PAGE]), gate)();
    expect(asked).toEqual([{ ...INPUT, pagesToRemove: [PAGE] }]);
    expect(calls.map((call) => call.op)).toEqual([
      "PreviewMapResources",
      "MapResources",
    ]);
    expect(calls[1]?.args).toEqual([
      { ...INPUT, approvedPageRemovals: [PAGE] },
    ]);
  });

  it("maps after a gate call with no pages when nothing is removed", async () => {
    const calls: Recorded[] = [];
    const asked: GateArgs[] = [];
    const gate: BuilderGate = async (_tool, args) => {
      asked.push(args);
      return { isAllowed: true };
    };
    const result = await mapResources(client(calls, []), gate)();
    expect(result.isError).toBeFalsy();
    expect(asked).toEqual([{ ...INPUT, pagesToRemove: [] }]);
    expect(calls.map((call) => call.op)).toEqual([
      "PreviewMapResources",
      "MapResources",
    ]);
  });

  it("approves no page when the preview listed none, so a page that appeared since is refused", async () => {
    const calls: Recorded[] = [];
    const gate: BuilderGate = async () => ({ isAllowed: true });
    await mapResources(client(calls, []), gate)();
    expect(calls[1]?.args).toEqual([{ ...INPUT, approvedPageRemovals: [] }]);
  });

  it("shows the agent the refusal of pages not approved as plain text", async () => {
    const message =
      "pages not approved for removal: pages.shop.shop-orders. The mapping would remove them now; nothing was written. Preview the mapping again and ask before removing them.";
    const racing: BuilderClient = {
      call: async (op) =>
        op === "PreviewMapResources"
          ? { ok: true, data: { pagesToRemove: [] }, changes: [] }
          : {
              ok: false,
              error: {
                code: "invalid_config",
                issues: [{ pointer: "", message }],
              },
            },
    };
    const result = await mapResources(racing, async () => ({
      isAllowed: true,
    }))();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: message }]);
  });

  it("says the Builder cannot preview page removals when its interface lacks the operation", async () => {
    const calls: Recorded[] = [];
    const gate = vi.fn<BuilderGate>(async () => ({ isAllowed: true }));
    const old: BuilderClient = {
      call: async (op, args) => {
        calls.push({ op, args });
        return {
          ok: false,
          error: { code: "unknown_op", detail: "PreviewMapResources" },
        };
      },
    };
    const result = await mapResources(old, gate)();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(
      "this Builder version cannot preview page removals; update @antelopejs/dms-builder",
    );
    expect(gate).not.toHaveBeenCalled();
    expect(calls.map((call) => call.op)).toEqual(["PreviewMapResources"]);
  });

  it("writes nothing when the person denies it", async () => {
    const calls: Recorded[] = [];
    const gate: BuilderGate = async () => ({
      isAllowed: false,
      message: "denied by the user",
    });
    const result = await mapResources(client(calls, [PAGE]), gate)();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("denied by the user");
    expect(calls.map((call) => call.op)).toEqual(["PreviewMapResources"]);
  });

  it("writes nothing when the Builder refuses the preview", async () => {
    const gate = vi.fn<BuilderGate>(async () => ({ isAllowed: true }));
    const calls: Recorded[] = [];
    const refusing: BuilderClient = {
      call: async (op, args) => {
        calls.push({ op, args });
        return { ok: false, error: { code: "invalid_config" } };
      },
    };
    const result = await mapResources(refusing, gate)();
    expect(result.isError).toBe(true);
    expect(gate).not.toHaveBeenCalled();
    expect(calls.map((call) => call.op)).toEqual(["PreviewMapResources"]);
  });

  it("refuses to map when the Builder's preview carries no pages list", async () => {
    const gate = vi.fn<BuilderGate>(async () => ({ isAllowed: true }));
    const calls: Recorded[] = [];
    const older: BuilderClient = {
      call: async (op, args) => {
        calls.push({ op, args });
        return { ok: true, data: { resources: [] }, changes: [] };
      },
    };
    const result = await mapResources(older, gate)();
    expect(result.isError).toBe(true);
    expect(calls.map((call) => call.op)).toEqual(["PreviewMapResources"]);
  });
});

describe("which mapping calls wait for the person", () => {
  it("waits only when pages would be removed", () => {
    expect(
      asksBeforeBuilderCall(TOOL, { ...INPUT, pagesToRemove: [PAGE] }),
    ).toBe(true);
    expect(asksBeforeBuilderCall(TOOL, { ...INPUT, pagesToRemove: [] })).toBe(
      false,
    );
    expect(asksBeforeBuilderCall(TOOL, INPUT)).toBe(false);
  });

  it("keeps asking for a page deletion whatever its arguments", () => {
    expect(asksBeforeBuilderCall("BuilderDeletePage", { pageRef: PAGE })).toBe(
      true,
    );
  });
});

describe("the approval card of a mapping", () => {
  const describeMapping = (args: GateArgs) =>
    describeRequest({
      toolName: `${MCP_TOOL_NAME_PREFIX}${TOOL}`,
      args,
      hostProjectRoot: "/project",
      alwaysAskDependencies: false,
      alwaysAskBlockRemoval: false,
      isAutoReview: true,
    });

  it("lists the pages it would remove, and always asks", async () => {
    const description = await describeMapping({
      ...INPUT,
      pagesToRemove: [PAGE, "pages.shop.shop-customers"],
    });
    expect(description.alwaysAsk).toBe(true);
    expect(description.ruleOptions).toEqual([]);
    expect(description.preview).toMatchObject({
      type: "destructive",
      operation: TOOL,
      target: `${PAGE}, pages.shop.shop-customers`,
      consequence: "removes_code",
    });
  });

  it("does not always ask for a mapping that removes nothing", async () => {
    const description = await describeMapping({ ...INPUT, pagesToRemove: [] });
    expect(description.alwaysAsk).toBe(false);
    expect(asksBeforeBuilderCall(TOOL, INPUT)).toBe(false);
  });
});
