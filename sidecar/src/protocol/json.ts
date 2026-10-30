import { z } from "zod";

/** A value `JSON.stringify` serialises as it is: an absent object member is left out. */
export type JsonValue =
  | number
  | string
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue | undefined };

/**
 * `T` when `JSON.stringify` writes it faithfully: primitives, arrays and
 * plain objects, with no function, symbol or bigint among the members the type
 * names. Unlike `JsonValue`, interface-typed objects qualify. A member typed
 * `unknown` passes as it is, because the type says nothing about it.
 */
export type Serializable<T> = unknown extends T
  ? T
  : T extends string | number | boolean | null | undefined
    ? T
    : T extends (...args: never[]) => void
      ? never
      : T extends readonly (infer Item)[]
        ? readonly Serializable<Item>[]
        : T extends object
          ? { [Key in keyof T]: Serializable<T[Key]> }
          : never;

/** Any value `JSON.parse` can produce. */
export const JsonValueSchema: z.ZodType<JsonValue> = z.json();
