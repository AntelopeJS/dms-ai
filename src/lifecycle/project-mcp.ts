import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { z } from "zod";
import {
  MCP_BRIDGE_CONFIG_FILE_NAME,
  MCP_BRIDGE_LAUNCHER_FILE_NAME,
  MCP_ROUTE_PATH,
  MCP_TOKEN_BYTES,
  PRIVATE_FILE_MODE,
  PROJECT_MCP_JSON_FILE_NAME,
  PROJECT_MCP_SERVER_KEY,
} from "../constants/mcp";
import { ROUTE_PREFIX } from "../constants/module";
import {
  SIDECAR_CACHE_DIR_SEGMENTS,
  SIDECAR_LOG_PREFIX,
} from "../constants/sidecar";

const PRIVATE_DIRECTORY_MODE = 0o700;
const BEARER_PREFIX = "Bearer ";
const JSON_INDENT = 2;
const FORMAT_PRINT_WIDTH = 80;
const EXPANDED_PRIMITIVE_ARRAY =
  /\[\n((?: *(?:"(?:[^"\\\n]|\\.)*"|-?\d[\d.eE+-]*|true|false|null),?\n)+) *\]/g;

/**
 * Serializes `.mcp.json` the way the projects' formatter (oxfmt, Prettier)
 * prints it: two-space indent, and an array of plain values on one line when
 * that line fits the print width, so the written file passes a format check.
 */
function formatMcpJson(value: McpJson): string {
  const expanded = JSON.stringify(value, null, JSON_INDENT);
  return expanded.replace(
    EXPANDED_PRIMITIVE_ARRAY,
    (match: string, body: string, offset: number) => {
      const items = body
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => line.trim().replace(/,$/, ""));
      const inline = `[${items.join(", ")}]`;
      const lineStart = expanded.lastIndexOf("\n", offset) + 1;
      const end = offset + match.length;
      const lineEnd = expanded.indexOf("\n", end);
      const before = offset - lineStart;
      const after = (lineEnd === -1 ? expanded.length : lineEnd) - end;
      return before + inline.length + after <= FORMAT_PRINT_WIDTH
        ? inline
        : match;
    },
  );
}

interface ProjectMcpState {
  token: string | null;
}

const state: ProjectMcpState = { token: null };

export interface PublishOptions {
  hostProjectRoot: string;
  backendUrl: string;
  /** Whether to add the server to the project's `.mcp.json`; the files in the cache are written either way. */
  writeMcpJson: boolean;
}

/** The launcher's path from the project root, in `/` form so `.mcp.json` reads the same on every OS. */
const LAUNCHER_FROM_ROOT = [
  ...SIDECAR_CACHE_DIR_SEGMENTS,
  MCP_BRIDGE_LAUNCHER_FILE_NAME,
].join("/");

function launcherSource(bridgePath: string): string {
  return `require(${JSON.stringify(bridgePath)}).runBridge(require("node:path").join(__dirname, ${JSON.stringify(MCP_BRIDGE_CONFIG_FILE_NAME)}));\n`;
}

/** Written beside the target and renamed over it, so a bridge never reads a half-written file. */
async function writePrivate(filePath: string, content: string): Promise<void> {
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode: PRIVATE_FILE_MODE });
  await chmod(temp, PRIVATE_FILE_MODE);
  await rename(temp, filePath);
}

const MissingFileSchema = z.object({ code: z.literal("ENOENT") });

/** What the module reads of `.mcp.json`: its servers, and every other key kept as written. */
const McpJsonSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.json()).optional(),
});

type McpJson = z.infer<typeof McpJsonSchema>;

/** The file's content; empty when there is none, `null` when it is not a `.mcp.json` the module can extend or could not be read. */
async function readMcpJson(filePath: string): Promise<McpJson | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    return MissingFileSchema.safeParse(err).success ? {} : null;
  }
  try {
    const parsed = McpJsonSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Adds the `dms-ai` server to the project's `.mcp.json` when it is not there,
 * keeping every other server. An entry already present is left as the
 * integrator wrote it, and a file the module cannot read as one is not touched.
 */
async function ensureMcpJsonEntry(root: string): Promise<void> {
  const filePath = path.join(root, PROJECT_MCP_JSON_FILE_NAME);
  const current = await readMcpJson(filePath);
  if (current === null) {
    Logging.Warn(
      `${SIDECAR_LOG_PREFIX} ${PROJECT_MCP_JSON_FILE_NAME} is not a JSON object with an object of servers; the ${PROJECT_MCP_SERVER_KEY} MCP server was not added`,
    );
    return;
  }
  const servers = current.mcpServers ?? {};
  if (Object.hasOwn(servers, PROJECT_MCP_SERVER_KEY)) return;
  const next = {
    ...current,
    mcpServers: {
      ...servers,
      [PROJECT_MCP_SERVER_KEY]: { command: "node", args: [LAUNCHER_FROM_ROOT] },
    },
  };
  await writeFile(filePath, `${formatMcpJson(next)}\n`);
}

/**
 * Publishes the project's MCP tools to agent sessions outside the dashboard
 * chat. A fresh credential is drawn for each start and written, with the
 * route, to a file only the project's user can read; a launcher of this build's
 * bridge sits beside it, and `.mcp.json` points Claude Code at the launcher.
 */
export async function publishProjectMcp(
  options: PublishOptions,
): Promise<void> {
  const cacheDir = path.join(
    options.hostProjectRoot,
    ...SIDECAR_CACHE_DIR_SEGMENTS,
  );
  await mkdir(cacheDir, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const token = randomBytes(MCP_TOKEN_BYTES).toString("hex");
  const url = `${options.backendUrl.replace(/\/$/, "")}${ROUTE_PREFIX}${MCP_ROUTE_PATH}`;
  await writePrivate(
    path.join(cacheDir, MCP_BRIDGE_CONFIG_FILE_NAME),
    JSON.stringify({ url, token }),
  );
  await writeFile(
    path.join(cacheDir, MCP_BRIDGE_LAUNCHER_FILE_NAME),
    launcherSource(require.resolve("../mcp-bridge")),
  );
  state.token = token;
  if (options.writeMcpJson) await ensureMcpJsonEntry(options.hostProjectRoot);
}

/** Whether an `Authorization` header carries the credential of this start. */
export function isProjectMcpRequest(
  authorization: string | undefined,
): boolean {
  const expected = state.token;
  if (expected === null || authorization === undefined) return false;
  if (!authorization.startsWith(BEARER_PREFIX)) return false;
  const actual = Buffer.from(authorization.slice(BEARER_PREFIX.length));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
