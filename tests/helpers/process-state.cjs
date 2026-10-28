const fs = require("node:fs");

const ZOMBIE_STATE = "Z";

/** The JSON a sidecar left at `file`, or null when it is absent or unreadable. */
function readLockFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Whether the process has exited but is not yet reaped by its parent. */
function isZombie(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith(ZOMBIE_STATE);
  } catch {
    return false;
  }
}

module.exports = { isZombie, readLockFile };
