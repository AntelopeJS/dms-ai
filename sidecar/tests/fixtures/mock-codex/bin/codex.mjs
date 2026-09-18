#!/usr/bin/env node
import {
  APP_SERVER_COMMAND,
  DEFAULT_VERSION,
  SCRIPT_ENV_VAR,
  VERSION_ARGUMENT,
  VERSION_ENV_VAR,
  VERSION_PREFIX,
} from "../src/constants.mjs";
import { loadDump } from "../src/dump.mjs";
import { runAppServer } from "../src/server.mjs";

const NO_SCRIPT_MESSAGE = `mock-codex: set ${SCRIPT_ENV_VAR} to one or more dump files`;
const UNKNOWN_COMMAND_EXIT = 2;

function printVersion() {
  const version = process.env[VERSION_ENV_VAR] ?? DEFAULT_VERSION;
  process.stdout.write(`${VERSION_PREFIX}${version}\n`);
}

function startAppServer() {
  const spec = process.env[SCRIPT_ENV_VAR];
  if (spec === undefined || spec === "") {
    process.stderr.write(`${NO_SCRIPT_MESSAGE}\n`);
    process.exit(UNKNOWN_COMMAND_EXIT);
  }
  runAppServer(loadDump(spec), process.stdin, process.stdout);
}

const COMMANDS = {
  [VERSION_ARGUMENT]: printVersion,
  [APP_SERVER_COMMAND]: startAppServer,
};

const command = COMMANDS[process.argv[2] ?? ""];
if (command === undefined) {
  process.stderr.write(`mock-codex: unsupported command ${process.argv[2]}\n`);
  process.exit(UNKNOWN_COMMAND_EXIT);
}
command();
