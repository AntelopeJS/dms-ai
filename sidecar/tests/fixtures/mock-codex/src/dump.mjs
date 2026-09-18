import { readFileSync } from "node:fs";
import {
  DIRECTION_IN,
  DIRECTION_OUT,
  SCRIPT_SEPARATOR,
  TURN_START_METHOD,
} from "./constants.mjs";

function parseLines(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line));
}

function isServerRequest(msg) {
  return msg.id !== undefined && msg.method !== undefined;
}

function isResponse(msg) {
  return msg.id !== undefined && msg.method === undefined;
}

// A dump records both directions, so a client request and the reply it got are
// two separate lines linked only by their id.
function collectResponses(entries) {
  const methodById = new Map();
  const byMethod = new Map();
  for (const { dir, msg } of entries) {
    if (dir === DIRECTION_OUT && isServerRequest(msg)) {
      methodById.set(msg.id, msg.method);
      continue;
    }
    if (dir !== DIRECTION_IN || !isResponse(msg)) continue;
    const method = methodById.get(msg.id);
    if (method === undefined) continue;
    byMethod.set(method, msg.result);
  }
  return byMethod;
}

// One turn is everything the server sent after a turn/start went out, minus the
// replies to the client's own calls. Notifications that belong to the session
// rather than the turn (thread/started, and the like) ride along; the adapter
// ignores what it does not handle, exactly as it does in production.
function collectTurns(entries) {
  const turns = [];
  let current = null;
  for (const { dir, msg } of entries) {
    if (dir === DIRECTION_OUT && msg.method === TURN_START_METHOD) {
      current = [];
      turns.push(current);
      continue;
    }
    if (current === null || dir !== DIRECTION_IN) continue;
    if (isResponse(msg)) continue;
    current.push(msg);
  }
  return turns;
}

/**
 * Loads one or more dumps. Responses merge (the last file wins), turns
 * concatenate — so a scenario can borrow a skills scan from one capture and its
 * turn from another, and a repeated file replays the same turn twice.
 */
export function loadDump(spec) {
  const entries = spec
    .split(SCRIPT_SEPARATOR)
    .map((path) => path.trim())
    .filter((path) => path !== "")
    .map((path) => parseLines(path));
  const responses = new Map();
  const turns = [];
  for (const parsed of entries) {
    for (const [method, result] of collectResponses(parsed)) {
      responses.set(method, result);
    }
    turns.push(...collectTurns(parsed));
  }
  return { responses, turns };
}
