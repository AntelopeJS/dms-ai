import { afterAll, beforeAll } from "vitest";
import { signInForTests, useTemporaryConfigHome } from "./chatgpt-auth.js";

/**
 * Undoes the temporary config home set up in `beforeAll`. Every suite runs
 * against its own config home, signed in: the mock Codex never reads the token,
 * but the provider refuses to start without a sign-in.
 */
let restore: (() => void) | undefined;

beforeAll(async () => {
  restore = useTemporaryConfigHome();
  await signInForTests();
});

afterAll(() => {
  restore?.();
});
