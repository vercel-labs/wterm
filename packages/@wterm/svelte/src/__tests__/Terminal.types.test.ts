import { expectTypeOf, describe, it } from "vitest";
import type {
  TerminalEvents,
  TerminalHandle,
  TerminalProps,
} from "../lib/Terminal.svelte";
import type { WTerm } from "@wterm/dom";

describe("Terminal types", () => {
  it("exposes typed props, events, and imperative methods", () => {
    expectTypeOf<TerminalProps["cols"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TerminalProps["rows"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TerminalProps["theme"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<TerminalProps["onData"]>().toEqualTypeOf<
      ((data: string) => void) | undefined
    >();
    expectTypeOf<TerminalEvents["data"]>().toEqualTypeOf<string>();
    expectTypeOf<TerminalEvents["resize"]>().toEqualTypeOf<
      [cols: number, rows: number]
    >();
    expectTypeOf<TerminalEvents["ready"]>().toEqualTypeOf<WTerm>();
    expectTypeOf<TerminalHandle>().toExtend<{
      write(data: string | Uint8Array): void;
      resize(cols: number, rows: number): void;
      focus(): void;
    }>();
  });
});
