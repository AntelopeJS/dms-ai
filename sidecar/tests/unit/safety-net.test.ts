import { describe, expect, it } from "vitest";
import type { TypecheckResult } from "../../src/agent/typecheck.js";
import type { LogsClient } from "../../src/logs/logs-client.js";
import type { BufferedLog } from "../../src/logs/types.js";
import {
  collectBuildIssues,
  summarizeReloadErrors,
  uniqueEditedRoots,
} from "../../src/server/safety-net.js";

const KNOWN_ROOTS = ["/proj", "/proj/modules/dms-ai"];

function noLogs(): LogsClient {
  return { getLogs: async () => [] };
}

function withLogs(logs: BufferedLog[]): LogsClient {
  return { getLogs: async () => logs };
}

const clean: TypecheckResult = {
  ran: true,
  ok: true,
  errorCount: 0,
  summary: "No type errors.",
};
const broken: TypecheckResult = {
  ran: true,
  ok: false,
  errorCount: 1,
  summary: "Type errors found:\nsrc/a.ts(1,2): error TS2322: nope",
};

describe("uniqueEditedRoots", () => {
  it("dedupes edited files down to their owning roots", () => {
    const roots = uniqueEditedRoots(
      [
        "/proj/modules/dms-ai/src/a.ts",
        "/proj/modules/dms-ai/src/b.ts",
        "/proj/app/c.ts",
      ],
      KNOWN_ROOTS,
    );
    expect(roots.sort()).toEqual(["/proj", "/proj/modules/dms-ai"]);
  });
});

describe("summarizeReloadErrors", () => {
  it("keeps only reload-channel error entries", () => {
    const summary = summarizeReloadErrors([
      {
        time: 1,
        channel: "loader.hot-reload",
        levelId: 40,
        args: ["error TS2322"],
      },
      { time: 2, channel: "app", levelId: 40, args: ["unrelated"] },
      { time: 3, channel: "loader.hot-reload", levelId: 20, args: ["info"] },
    ]);
    expect(summary).toContain("error TS2322");
    expect(summary).not.toContain("unrelated");
    expect(summary).not.toContain("info");
  });

  it("returns null when nothing matches", () => {
    expect(summarizeReloadErrors([])).toBeNull();
  });
});

describe("collectBuildIssues", () => {
  const base = {
    editedFiles: ["/proj/modules/dms-ai/src/a.ts"],
    knownRoots: KNOWN_ROOTS,
    sinceMs: 0,
    delay: async () => {},
  };

  it("returns null when the build is healthy", async () => {
    const result = await collectBuildIssues({
      ...base,
      logsClient: noLogs(),
      runTypecheckFn: async () => clean,
    });
    expect(result).toBeNull();
  });

  it("returns a heal prompt when the typecheck fails", async () => {
    const result = await collectBuildIssues({
      ...base,
      logsClient: noLogs(),
      runTypecheckFn: async () => broken,
    });
    expect(result).not.toBeNull();
    expect(result).toContain("error TS2322");
  });

  it("returns a heal prompt when the host log has reload errors", async () => {
    const result = await collectBuildIssues({
      ...base,
      logsClient: withLogs([
        {
          time: 5,
          channel: "loader.hot-reload",
          levelId: 40,
          args: ["reload failed"],
        },
      ]),
      runTypecheckFn: async () => clean,
    });
    expect(result).not.toBeNull();
    expect(result).toContain("reload failed");
  });
});
