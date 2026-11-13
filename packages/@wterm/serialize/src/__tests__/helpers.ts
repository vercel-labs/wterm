import type { WTerm } from "@wterm/dom";
import { WasmBridge } from "@wterm/core";

export async function makeTerm(
  cols: number,
  rows: number,
): Promise<Pick<WTerm, "bridge" | "write">> {
  const bridge = await WasmBridge.load();
  bridge.init(cols, rows);

  return {
    bridge,
    write(data: string | Uint8Array) {
      if (typeof data === "string") {
        bridge.writeString(data);
      } else {
        bridge.writeRaw(data);
      }
    },
  };
}
