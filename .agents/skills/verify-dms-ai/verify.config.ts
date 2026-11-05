/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs and declared funnel modules. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
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
  notUserFacing: [
    "frontend-vue/tests/**",
    "frontend-vue/eslint.config.mjs",
    "frontend-vue/vitest.config.ts",
    "frontend-vue/pnpm-lock.yaml",
    "frontend-vue/tsconfig.chat.json",
    "frontend-vue/.*",
  ],
  smoke: "smoke",
  smokeJourney: "onboard, open the Overview, read the assistant's status, change a setting and see it kept",
  doors: {
    data: {
      globs: ["sidecar/src/state/**", "sidecar/src/checkpoints/**", "sidecar/src/server/change-set-actions.ts"],
      funnels: [],
      why: "the sidecar's stored settings, transcripts and change-set checkpoints are the only record of what the owner chose and of what Undo restores; a change that drops or rewrites them is not undone by reverting the code",
    },
    format: {
      globs: ["sidecar/src/state/settings-store.ts", "sidecar/src/state/settings-types.ts", "sidecar/src/state/types.ts"],
      funnels: [],
      why: "the settings file and the transcripts on disk are read back by the next version of the module",
    },
    contract: {
      globs: ["package.json", "src/routes/**", "src/constants/module.ts", "src/constants/pages.ts", "frontend-vue/package.json"],
      funnels: [],
      why: "the dashboard, the sidecar and other modules call these HTTP routes and page paths, and projects set the module option and the renderer range",
    },
    outbound: {
      globs: ["sidecar/src/providers/**", "sidecar/src/constants/chatgpt.ts", "sidecar/src/constants/claude.ts", "sidecar/src/server/client-auth.ts"],
      funnels: [],
      why: "the providers send the project's code and the owner's ChatGPT credentials to OpenAI and Anthropic",
    },
    exposure: {
      globs: ["src/routes/**", "src/channels/**", "sidecar/src/server/client-auth.ts", "sidecar/src/server/http.ts", "sidecar/src/server/http-routes.ts", "sidecar/src/agent/read-access.ts", "sidecar/src/agent/permission-rules.ts"],
      funnels: [],
      why: "these decide who may reach the owner's routes, the sidecar and the agent's access to files and commands",
    },
    publish: {
      globs: ["package.json", "sidecar/package.json", ".release-it.json", "changelogen.config.json", ".github/workflows/release.yml"],
      funnels: [],
      why: "the package name, its files and the release workflow claim @antelopejs/dms-ai in the npm registry",
    },
  },
  formal: [],
};

export default config;
