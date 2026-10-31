"use client";

import { useCallback } from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { SessionWorkspace } from "../session-workspace";

export default function GhosttyTerminal() {
  const coreLoader = useCallback(
    () => GhosttyCore.load({ wasmPath: "/ghostty-vt.wasm" }),
    [],
  );

  return (
    <SessionWorkspace
      coreLoader={coreLoader}
      maxImageWidth={640}
      maxImageHeight={480}
    />
  );
}
