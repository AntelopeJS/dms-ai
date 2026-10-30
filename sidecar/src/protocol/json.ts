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

function isScalar(node: unknown): node is string | number | boolean | null {
  return (
    node === null ||
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean"
  );
}

function isPlainObject(node: unknown): node is object {
  return (
    node !== null &&
    typeof node === "object" &&
    Object.getPrototypeOf(node) === Object.prototype
  );
}

/**
 * Whether `value` is a tree of what `JSON.parse` builds. Unlike
 * `JsonValueSchema` it hands the value back as it is: it reads every own key,
 * `__proto__` included, and accepts a number `JSON.parse` reads as infinite.
 * It walks the tree with a stack, so a deeply nested body cannot overflow it.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      for (const item of node) pending.push(item);
    } else if (isPlainObject(node)) {
      for (const member of Object.values(node)) pending.push(member);
    } else if (!isScalar(node)) {
      return false;
    }
  }
  return true;
}
