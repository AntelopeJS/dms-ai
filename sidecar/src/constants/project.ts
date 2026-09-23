export const PACKAGE_JSON_FILENAME = "package.json";
export const ANTELOPE_PREFIXES = ["@antelopejs/"] as const;
export const PROJECT_INFO_FALLBACK = {
  name: "unknown",
  version: "0.0.0",
  antelopeModules: [] as string[],
} as const;
export const PACKAGE_JSON_ENCODING = "utf8" as const;
