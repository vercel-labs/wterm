import { describe, it, expectTypeOf } from "vitest";
import { ref } from "vue";
import { Terminal } from "../index.js";
import type { WTerm } from "@wterm/dom";

describe("Terminal types", () => {
  it("template refs carry the imperative handle", () => {
    const r = ref<InstanceType<typeof Terminal> | null>(null);

    // Exposed methods are typed through InstanceType.
    expectTypeOf(r.value?.write).toEqualTypeOf<
      ((data: string | Uint8Array) => void) | undefined
    >();
    expectTypeOf(r.value?.resize).toEqualTypeOf<
      ((cols: number, rows: number) => void) | undefined
    >();
    expectTypeOf(r.value?.focus).toEqualTypeOf<(() => void) | undefined>();
    expectTypeOf(r.value?.instance).toEqualTypeOf<WTerm | null | undefined>();

    // Valid calls compile (compile-only; guarded at runtime).
    if (0) {
      r.value?.write("x");
      r.value?.write(new Uint8Array());
      r.value?.resize(80, 24);
      r.value?.focus();

      // @ts-expect-error — wrong argument type
      r.value?.write(42);
      // @ts-expect-error — wrong arity
      r.value?.resize(80);
    }
  });

  it("InstanceType is assignable to TerminalHandle", () => {
    type Instance = NonNullable<InstanceType<typeof Terminal>>;
    expectTypeOf<Instance>().toExtend<{
      write: (data: string | Uint8Array) => void;
      resize: (cols: number, rows: number) => void;
      focus: () => void;
      instance: WTerm | null;
    }>();
  });

  it("typed props", () => {
    type Props = InstanceType<typeof Terminal>["$props"];
    expectTypeOf<Props["cols"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Props["rows"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Props["theme"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Props["wasmUrl"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Props["autoResize"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props["cursorBlink"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props["debug"]>().toEqualTypeOf<boolean | undefined>();
  });

  it("typed emit signatures", () => {
    // Grab the emit function type from the component options. Vue's
    // emits-as-object-with-validators makes emit overloaded per event.
    type Opts = typeof Terminal extends { new (...args: any): infer I }
      ? I
      : never;
    // $emit is the Vue emit helper on the instance.
    type Emit = Opts extends { $emit: infer E } ? E : never;

    // Accept valid payloads.
    expectTypeOf<Emit>().toBeCallableWith("data", "hello");
    expectTypeOf<Emit>().toBeCallableWith("title", "new title");
    expectTypeOf<Emit>().toBeCallableWith("resize", 80, 24);
    expectTypeOf<Emit>().toBeCallableWith("ready", {} as WTerm);
    expectTypeOf<Emit>().toBeCallableWith("error", new Error("x"));

    // Reject bad payloads (compile-only; guarded at runtime).
    const _typecheck = (emit: Emit) => {
      if (0) {
        // @ts-expect-error — data takes a string, not a number
        emit("data", 42);
        // @ts-expect-error — resize needs two numbers
        emit("resize", 80);
        // @ts-expect-error — unknown event
        emit("bogus", "x");
      }
    };
    void _typecheck;
  });
});
