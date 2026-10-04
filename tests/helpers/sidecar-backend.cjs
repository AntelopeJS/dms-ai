// A backend reduced to the module's launcher: it starts the sidecar, reports
// it is ready, then runs until a signal ends it.
const { loadLauncherGeneration } = require("./sidecar-launcher.cjs");

const READY_LINE = "ready\n";
const KEEP_ALIVE_MS = 60_000;

void loadLauncherGeneration()
  .spawnSidecar({ hostProjectRoot: process.cwd() })
  .then(() => {
    process.stdout.write(READY_LINE);
    setInterval(() => undefined, KEEP_ALIVE_MS);
  });
