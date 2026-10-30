const fs = require("node:fs");
const { z } = require("zod");

const ZOMBIE_STATE = "Z";
const LockSchema = z.looseObject({
  pid: z.number(),
  port: z.number(),
  buildId: z.string(),
});

/**
 * The lock a sidecar left at `file`, or null when it is absent, unreadable or
 * not a lock.
 * @param {string} file
 */
function readLockFile(file) {
  try {
    return LockSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

/**
 * Whether the process has exited but is not yet reaped by its parent.
 * @param {number} pid
 */
function isZombie(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith(ZOMBIE_STATE);
  } catch {
    return false;
  }
}

module.exports = { isZombie, readLockFile };
