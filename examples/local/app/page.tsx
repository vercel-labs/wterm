import { SessionWorkspace } from "./session-workspace";

export default function LocalTerminal() {
  return <SessionWorkspace wasmUrl="/wterm.wasm" />;
}
