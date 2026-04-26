import { describe, it, expectTypeOf } from "vitest";
import type Terminal from "../Terminal.svelte";
import type { ComponentProps } from "svelte";
import type { WTerm } from "@wterm/dom";

describe("Terminal types", () => {
  it("bind:this carries the imperative handle", () => {
    let terminal: Terminal | undefined;

    expectTypeOf(terminal?.write).toEqualTypeOf<
      ((data: string | Uint8Array) => void) | undefined
    >();
    expectTypeOf(terminal?.resize).toEqualTypeOf<
      ((cols: number, rows: number) => void) | undefined
    >();
    expectTypeOf(terminal?.focus).toEqualTypeOf<(() => void) | undefined>();
    expectTypeOf(terminal?.instance).toEqualTypeOf<
      (() => WTerm | null) | undefined
    >();

    if (0) {
      terminal?.write("x");
      terminal?.write(new Uint8Array());
      terminal?.resize(80, 24);
      terminal?.focus();

      // @ts-expect-error — wrong argument type
      terminal?.write(42);
      // @ts-expect-error — wrong arity
      terminal?.resize(80);
    }
  });

  it("typed props", () => {
    type Props = ComponentProps<typeof Terminal>;
    expectTypeOf<Props["cols"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Props["rows"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Props["theme"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Props["wasmUrl"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Props["autoResize"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props["cursorBlink"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props["debug"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Props["onData"]>().toEqualTypeOf<
      ((data: string) => void) | undefined
    >();
    expectTypeOf<Props["onReady"]>().toEqualTypeOf<
      ((wt: WTerm) => void) | undefined
    >();
  });
});
