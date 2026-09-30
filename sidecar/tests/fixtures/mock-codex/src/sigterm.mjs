import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CODEX_HOME_ENV_VAR,
  HOME_WRITE_INTERVAL_MS,
  HOME_WRITE_PREFIX,
  IGNORE_SIGTERM,
  LINGER_MS,
  LINGER_ON_SIGTERM,
  ON_SIGTERM_ENV_VAR,
} from "./constants.mjs";

// The real app-server keeps databases and logs open in its home, so it can still
// be writing there when it is told to stop. This stretches that moment until it
// can be observed. The directory is recreated on every write, the way a logger
// does, so a home removed too early comes back.
function writeIntoHome(home, index) {
  try {
    mkdirSync(home, { recursive: true });
    writeFileSync(
      path.join(home, `${HOME_WRITE_PREFIX}${index}`),
      String(Date.now()),
    );
  } catch {
    // Raced by the removal itself: the next tick writes again.
  }
}

function keepWriting(home) {
  let index = 0;
  setInterval(() => writeIntoHome(home, index++), HOME_WRITE_INTERVAL_MS);
}

const ON_SIGTERM = {
  [LINGER_ON_SIGTERM]: (home) => {
    keepWriting(home);
    setTimeout(() => process.exit(0), LINGER_MS);
  },
  [IGNORE_SIGTERM]: (home) => keepWriting(home),
};

export function installSigtermBehaviour() {
  const react = ON_SIGTERM[process.env[ON_SIGTERM_ENV_VAR] ?? ""];
  const home = process.env[CODEX_HOME_ENV_VAR];
  if (react === undefined || home === undefined) return;
  let isStopping = false;
  process.on("SIGTERM", () => {
    if (isStopping) return;
    isStopping = true;
    react(home);
  });
}
