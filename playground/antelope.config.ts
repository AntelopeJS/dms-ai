import { defineConfig } from "@antelopejs/interface-core/config";

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
        version: ">=0.0.1 <1.0.0",
      },
      config: {
        homepage: "/home",
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
    },
    "dms-builder": {
      source: {
        type: "package",
        package: "@antelopejs/dms-builder",
        version: ">=0.0.1 <1.0.0",
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.2.4",
      },
      config: {
        url: "mongodb://localhost:27017",
        database: "dms-ai-playground",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.1",
      },
      config: {
        secret: "dev",
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "1.2.5",
      },
      config: {
        servers: [
          {
            protocol: "http",
            port: "5010",
          },
        ],
      },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "^0.1.2",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "http://127.0.0.1:5010",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "0.0.4",
      },
      config: {
        ethereal: true,
      },
    },
  },
});
