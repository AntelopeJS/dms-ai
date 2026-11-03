/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs, declared funnel modules, and the journeys, as `feature/journey`, that contain it. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  containments: string[];
  why: string;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: never[];
}

const SKILL = ".agents/skills/verify-dms-ai";
const PLAYGROUND = `${SKILL}/playground`;

const config: VerifyConfig = {
  playground: PLAYGROUND,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["pnpm", "run", "build:sidecar"],
    ["pnpm", "install", "--dir", PLAYGROUND, "--ignore-workspace", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["npm", "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", SKILL, "playwright-core@1.56.1"],
    [`${PLAYGROUND}/node_modules/.bin/tsc`, "-p", `${PLAYGROUND}/tsconfig.build.json`],
  ],
  userFacing: ["src/**", "sidecar/src/**", "frontend-vue/**", "skills/**", "package.json", "sidecar/package.json"],
  notUserFacing: [],
  smoke: "smoke",
  smokeJourney: "onboard, open the Overview, read the assistant's status, change a setting and see it kept",
  doors: {
    data: null,
    format: null,
    contract: null,
    outbound: null,
    exposure: null,
    publish: null,
  },
  formal: [],
};

export default config;
