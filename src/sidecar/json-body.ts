/** A value `JSON.parse` yields. */
export type JsonBody =
  | string
  | number
  | boolean
  | null
  | JsonBody[]
  | { [key: string]: JsonBody };

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
 * Whether `value` is a tree of what `JSON.parse` builds. It walks the tree
 * with a stack, so a deeply nested body cannot overflow it, and it reads
 * every own key, `__proto__` included.
 */
export function isJsonBody(value: unknown): value is JsonBody {
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
