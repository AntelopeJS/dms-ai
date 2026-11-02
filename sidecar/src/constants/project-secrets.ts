export const SECRET_FILE_NAME = ".env";
export const SECRET_FILE_NAME_PREFIX = ".env.";

export const SECRET_FILE_TEMPLATE_NAMES: ReadonlySet<string> = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

export const AGENT_REQUIRED_ENV_NAMES: ReadonlySet<string> = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "PATH",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
]);

export const SECRET_FILE_DENIED_MESSAGE =
  "This file holds the project's secrets, so the assistant may not read or change it. Use the variable names listed in .env.example, and ask the user to set their values in .env.";
