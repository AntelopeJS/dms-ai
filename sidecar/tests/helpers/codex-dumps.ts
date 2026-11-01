import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { CodexNotification } from "../../src/providers/codex/client.js";

const DUMPS = resolve(__dirname, "../fixtures/codex-dumps");

const DumpFrame = z.object({
  dir: z.string(),
  msg: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    method: z.string().optional(),
    params: z.unknown().optional(),
  }),
});

/**
 * The server-to-client notifications of a recorded session. A frame carrying
 * both an id and a method is an approval request, which the permission layer
 * owns, so it never reaches the adapter.
 */
export function readNotifications(name: string): CodexNotification[] {
  return readFileSync(resolve(DUMPS, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line): CodexNotification[] => {
      const { dir, msg } = DumpFrame.parse(JSON.parse(line));
      if (dir !== "in" || msg.method === undefined || msg.id !== undefined) {
        return [];
      }
      return [{ method: msg.method, params: msg.params }];
    });
}
