import { expectTypeOf, describe, it } from "vitest";
import type { TerminalHandle, TerminalProps } from "../lib/Terminal.svelte";
import type { WTerm } from "@wterm/dom";

describe("Terminal types", () => {
  it("exposes typed props, callbacks, and imperative methods", () => {
    expectTypeOf<TerminalProps["cols"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TerminalProps["rows"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TerminalProps["theme"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<TerminalProps["onData"]>().toEqualTypeOf<
      ((data: string) => void) | undefined
    >();
    expectTypeOf<TerminalProps["onReady"]>().toEqualTypeOf<
      ((wt: WTerm) => void) | undefined
    >();
    expectTypeOf<TerminalHandle>().toExtend<{
      write(data: string | Uint8Array): void;
      resize(cols: number, rows: number): void;
      focus(): void;
    }>();
  });
});
