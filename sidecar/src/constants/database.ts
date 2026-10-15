export const DATABASE_CONNECTIONS_PATH = "/ai/database/connections";
export const DATABASE_RELATIONS_PATH = "/ai/database/relations";
export const DATABASE_DESCRIBE_PATH = "/ai/database/describe";
export const DATABASE_PROFILE_PATH = "/ai/database/profile";
// A profile runs one measure after another, each bounded by the provider's statement timeout.
export const DATABASE_FETCH_TIMEOUT_MS = 120_000;
export const DATABASE_LOG_PREFIX = "[database]";

export const DATABASE_CONNECTIONS_TOOL_NAME = "DatabaseConnections";
export const DATABASE_RELATIONS_TOOL_NAME = "DatabaseRelations";
export const DATABASE_DESCRIBE_TOOL_NAME = "DatabaseDescribe";
export const DATABASE_PROFILE_TOOL_NAME = "DatabaseProfile";

export const DATABASE_TOOL_NAMES: readonly string[] = [
  DATABASE_CONNECTIONS_TOOL_NAME,
  DATABASE_RELATIONS_TOOL_NAME,
  DATABASE_DESCRIBE_TOOL_NAME,
  DATABASE_PROFILE_TOOL_NAME,
];
