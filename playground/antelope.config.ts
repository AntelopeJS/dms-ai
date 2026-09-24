import { defineConfig } from "@antelopejs/interface-core/config";

// Origin the DMS frontend is served from. The api module cannot publish it --
// it only knows its own origins -- so it stays a literal here, overridable for
// the gateway setup.
const FRONTEND_ORIGIN = "http://localhost:3001";
const FRONTEND_LOOPBACK_ORIGIN = "http://127.0.0.1:3001";
const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;
const frontendOrigin = dmsClientUrl ?? FRONTEND_ORIGIN;
// Port the api module *prefers*; it publishes the one it actually reserved as
// API_LOCAL_BASE_URL, which is what every other module here consumes.
const API_PREFERRED_PORT = "5010";
const apiLocalBaseUrl = "${@api.API_LOCAL_BASE_URL}";

export default defineConfig({
  name: "dms-ai-playground",
  logging: {
    channelFilter: {
      "*": "trace",
    },
  },
  modules: {
    playground: {
      source: {
        type: "local",
        path: ".",
        installCommand: ["pnpm install", "pnpm build"],
      },
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.4.0 <1.0.0",
      },
      config: {
        homepage: "/home",
        auth: {
          jwtSecret: "dev",
        },
        meta: {
          title: "dms-ai",
          description: "dms-ai playground",
        },
      },
    },
    "dms-ai": {
      source: {
        type: "local",
        path: "../",
        watchDir: ["src"],
        installCommand: ["pnpm install", "pnpm build", "pnpm build:sidecar"],
      },
      config: {
        backendUrl: apiLocalBaseUrl,
        hostOrigin: frontendOrigin,
      },
    },
    "dms-builder": {
      source: {
        type: "package",
        package: "@antelopejs/dms-builder",
        version: ">=0.2.0 <1.0.0",
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.3.1",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: "dms-ai-playground",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.3",
      },
      config: {
        secret: "dev",
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.3.0",
      },
      config: {
        servers: [
          {
            protocol: "http",
            port: API_PREFERRED_PORT,
          },
        ],
        cors: {
          allowedOrigins: [
            FRONTEND_ORIGIN,
            FRONTEND_LOOPBACK_ORIGIN,
            /^https:\/\/[^/]+\.onamp\.dev$/,
            ...(dmsClientUrl ? [dmsClientUrl] : []),
          ],
        },
      },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "^0.1.5",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: apiLocalBaseUrl,
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "0.0.5",
      },
      config: {
        ethereal: true,
      },
    },
  },
});
