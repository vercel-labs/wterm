import { describe, it, expectTypeOf } from "vitest";
describe("Terminal types", () => {
    it("bind:this carries the imperative handle", () => {
        let terminal;
        expectTypeOf(terminal?.write).toEqualTypeOf();
        expectTypeOf(terminal?.resize).toEqualTypeOf();
        expectTypeOf(terminal?.focus).toEqualTypeOf();
        expectTypeOf(terminal?.instance).toEqualTypeOf();
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
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
        expectTypeOf().toEqualTypeOf();
    });
});
