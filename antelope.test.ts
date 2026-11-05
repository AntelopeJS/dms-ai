import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const ANY_FREE_PORT = 0;
const API_LOCAL_BASE_URL = "${@api.API_LOCAL_BASE_URL}";
const UNUSED_PUBLIC_BASE_URL = "https://api.test.example.com";
const CLIENT_BASE_URL = "http://localhost:3001";
const JWT_SECRET = "dms-ai-test-jwt-secret";
const HTML_RENDER_SECRET = "dms-ai-test-html-render-secret";
const BOOTSTRAP_SECRET = "dms-ai-test-bootstrap-secret";
const MONGO_BINARY_VERSION = "8.0.8";
const UNREACHABLE_SMTP_HOST = "127.0.0.1";
const CLOSED_SMTP_PORT = 1;
const SIDECAR_ENTRY_ENV = "DMS_AI_SIDECAR_ENTRY";
const STAND_IN_SIDECAR = "tests/data-paths/fixtures/stand-in-sidecar.cjs";
const SALES_HOST = "tests/data-paths/fixtures/sales-host";
const SETUP_TOKEN_ENV = "DMS_SETUP_TOKEN";
const SETUP_TOKEN = "dms-ai-test-setup-token";

let mongod: MongoMemoryReplSet | undefined;
let storageDir: string | undefined;

/**
 * The data-path suite (`pnpm test:data-paths`): the module booted with the DMS
 * it ships for, a real API server, real MongoDB and a stand-in sidecar.
 */
export default defineConfig({
  name: "dms-ai-data-paths",
  cacheFolder: ".antelope/cache",
  logging: { channelFilter: { "*": "warn" } },
  modules: {
    "dms-ai": {
      source: { type: "local", path: ".", installCommand: [] },
      config: { backendUrl: API_LOCAL_BASE_URL },
    },
    dms: {
      source: {
        type: "local",
        path: realpathSync("node_modules/@antelopejs/dms"),
        installCommand: [],
      },
      config: {
        clientBaseUrl: CLIENT_BASE_URL,
        auth: { jwtSecret: JWT_SECRET },
        htmlRender: { serviceSecret: HTML_RENDER_SECRET },
        frontend: { bootstrapSecret: BOOTSTRAP_SECRET },
      },
    },
    "sales-host": {
      source: {
        type: "local",
        path: SALES_HOST,
        installCommand: ["npx tsc -p tsconfig.json"],
      },
      config: { apiBaseUrl: API_LOCAL_BASE_URL },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "1.6.2",
      },
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "1.0.3",
      },
      config: { secret: JWT_SECRET },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "1.7.0",
      },
      config: {
        publicBaseUrl: UNUSED_PUBLIC_BASE_URL,
        servers: [{ protocol: "http", host: "127.0.0.1", port: ANY_FREE_PORT }],
      },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "0.1.13",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "0.0.6",
      },
      config: { host: UNREACHABLE_SMTP_HOST, port: CLOSED_SMTP_PORT },
    },
  },
  test: {
    folder: "tests/data-paths",
    async setup() {
      process.env[SIDECAR_ENTRY_ENV] = resolve(STAND_IN_SIDECAR);
      process.env[SETUP_TOKEN_ENV] = SETUP_TOKEN;
      mongod = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        binary: { version: MONGO_BINARY_VERSION },
      });
      storageDir = await mkdtemp(join(tmpdir(), "dms-ai-data-paths-"));
      return {
        modules: {
          mongodb: { config: { url: mongod.getUri(), database: "dms-core" } },
          "file-storage-local": {
            config: {
              storagePath: storageDir,
              baseUrl: API_LOCAL_BASE_URL,
              defaultVisibility: "private",
            },
          },
        },
      };
    },
    async cleanup() {
      try {
        await mongod?.stop();
      } finally {
        if (storageDir) await rm(storageDir, { recursive: true, force: true });
      }
    },
  },
});
