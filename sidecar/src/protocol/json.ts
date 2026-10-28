import { z } from "zod";

/** A value `JSON.stringify` serialises as it is: an absent object member is left out. */
export type JsonValue =
  | number
  | string
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

/** Any value `JSON.parse` can produce. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.json();
