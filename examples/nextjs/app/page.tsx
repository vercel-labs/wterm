"use client";

import { useCallback, useRef, useState } from "react";
import { Terminal, useTerminal } from "@wterm/react";
import { BashShell } from "@wterm/just-bash";
import "@wterm/react/css";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface Theme {
  value: string;
  theme: string | undefined;
}

const THEMES: Theme[] = [
  { value: "Default", theme: undefined },
  { value: "Solarized Dark", theme: "solarized-dark" },
  { value: "Monokai", theme: "monokai" },
  { value: "Light", theme: "light" },
];

const INITIAL_FILES: Record<string, string> = {
  "/home/user/README.md":
    "# wterm\n\nA terminal emulator for the web.\nRenders to the DOM — native text selection, copy/paste, and accessibility come for free.\nThe core is written in Zig and compiled to WASM.\n\nUses just-bash for shell execution.\n",
  "/home/user/package.json":
    '{\n  "name": "wterm",\n  "version": "0.1.0",\n  "description": "Terminal emulator for the web"\n}\n',
  "/home/user/src/main.zig":
    'const std = @import("std");\n\npub fn main() void {\n    std.debug.print("Hello from Zig!\\n", .{});\n}\n',
  "/home/user/examples/hello.sh":
    '#!/bin/bash\necho "Hello from wterm!"\necho "Date: $(date)"\necho "Shell: $SHELL"\n',
};

export default function Home() {
  const { ref, write } = useTerminal();
  const [themeLabel, setThemeLabel] = useState("Default");
  const [title, setTitle] = useState("wterm");
  const theme = THEMES.find((t) => t.value === themeLabel)?.theme;
  const shellRef = useRef<BashShell | null>(null);

  const handleReady = useCallback(() => {
    if (shellRef.current) return;
    const shell = new BashShell({
      files: INITIAL_FILES,
      greeting: [
        "\x1b[1;36mwterm\x1b[0m — terminal emulator for the web",
        "\x1b[2mPowered by just-bash · running entirely in the browser\x1b[0m",
        "",
        "Type \x1b[1mhelp\x1b[0m for commands, or try: \x1b[33mls\x1b[0m, \x1b[33mcat README.md\x1b[0m, \x1b[33mbash examples/hello.sh\x1b[0m",
        "",
      ],
    });
    shellRef.current = shell;
    shell.attach(write);
  }, [write]);

  const handleData = useCallback((data: string) => {
    shellRef.current?.handleInput(data);
  }, []);

  return (
    <div className="flex min-h-screen flex-col gap-6 p-6">
      <header className="flex items-center justify-between px-2">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <div className="flex items-center gap-3">
          <Label className="text-muted-foreground">Theme</Label>
          <Select
            value={themeLabel}
            onValueChange={(v) => v && setThemeLabel(v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEMES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center">
        <Terminal
          ref={ref}
          cols={80}
          rows={24}
          wasmUrl="/wterm.wasm"
          theme={theme}
          onData={handleData}
          onTitle={setTitle}
          onReady={handleReady}
          className="w-full max-w-[900px]"
        />
      </main>
    </div>
  );
}
