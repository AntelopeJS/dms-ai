import { describe, expectTypeOf, it } from "vitest";
import type { BuilderClient } from "../../src/builder/builder-client.js";

const call: BuilderClient["call"] = async () => ({ ok: true });

describe("the Builder client's request type", () => {
  it("takes each operation's own parameters", () => {
    expectTypeOf(call<"GetPageStructure">).parameters.toEqualTypeOf<
      ["GetPageStructure", [ref: string]]
    >();
    expectTypeOf(call<"ListPages">).parameters.toEqualTypeOf<
      ["ListPages", []]
    >();
    expectTypeOf(call<"GetMapping">).parameters.toEqualTypeOf<
      ["GetMapping", [connection: string, module: string]]
    >();
  });

  it("takes an operation name only from the interface", () => {
    expectTypeOf<
      Parameters<BuilderClient["call"]>[0]
    >().not.toEqualTypeOf<string>();
    expectTypeOf<"ListPages">().toExtend<
      Parameters<BuilderClient["call"]>[0]
    >();
    expectTypeOf<"NotAnOperation">().not.toExtend<
      Parameters<BuilderClient["call"]>[0]
    >();
  });
});
