export const SHORTCUTS_KEY = "wterm.local.shortcuts.v1";
export const COMMANDS = [
  { id: "new", label: "New terminal session" },
  { id: "close", label: "Close current session" },
  { id: "splitRight", label: "Split right" },
  { id: "splitDown", label: "Split down" },
  { id: "zoom", label: "Zoom or restore pane" },
  { id: "left", label: "Focus pane left" },
  { id: "right", label: "Focus pane right" },
  { id: "up", label: "Focus pane above" },
  { id: "down", label: "Focus pane below" },
  { id: "find", label: "Find in terminal" },
  { id: "previousPrompt", label: "Previous prompt" },
  { id: "nextPrompt", label: "Next prompt" },
] as const;
export type Command = (typeof COMMANDS)[number]["id"];
export type Shortcuts = Record<Command, readonly string[]>;
export const DEFAULT_SHORTCUTS: Shortcuts = {
  new: [],
  close: [],
  splitRight: [],
  splitDown: [],
  zoom: [],
  left: ["Meta+Alt+ArrowLeft", "Control+Alt+ArrowLeft"],
  right: ["Meta+Alt+ArrowRight", "Control+Alt+ArrowRight"],
  up: ["Meta+Alt+ArrowUp", "Control+Alt+ArrowUp"],
  down: ["Meta+Alt+ArrowDown", "Control+Alt+ArrowDown"],
  find: ["Meta+KeyF", "Control+Shift+KeyF"],
  previousPrompt: [],
  nextPrompt: [],
};
const MODIFIERS = ["Control", "Meta", "Alt", "Shift"] as const;
const KEY =
  /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Arrow(Left|Right|Up|Down)|Enter|Space|Backspace|Delete|Insert|Home|End|PageUp|PageDown)$/;

/** Keep browser navigation, clipboard operations, and shell interruption available. */
export function bindingError(binding: string): string | null {
  const parts = binding.split("+");
  const code = parts.pop()!;
  const modifiers = new Set(parts);
  if (
    !KEY.test(code) ||
    MODIFIERS.filter((name) => modifiers.has(name)).join("+") !==
      parts.join("+")
  )
    return "Choose a letter, number, navigation key, or function key.";
  const ctrl = modifiers.has("Control"),
    meta = modifiers.has("Meta"),
    alt = modifiers.has("Alt"),
    shift = modifiers.has("Shift");
  if (!ctrl && !meta) return "Include Control or Command in the shortcut.";
  if (ctrl && alt && !meta && /^(Key|Digit|Space)/.test(code))
    return "Control+Alt text keys are reserved for AltGr typing.";
  if (
    (!alt && /^(Key[ACVXZ])$/.test(code)) ||
    (ctrl && !meta && !alt && !shift && /^(Key[CDZ])$/.test(code)) ||
    (!alt && /^(Key[LNTRW]|Digit[0-9])$/.test(code)) ||
    (meta && /^(Key[QHM])$/.test(code)) ||
    code === "F5" ||
    (ctrl && /^(PageUp|PageDown)$/.test(code))
  )
    return "That combination is reserved for the browser, clipboard, or shell.";
  return null;
}

export function conflictingCommand(
  shortcuts: Shortcuts,
  command: Command,
  binding: string,
): Command | undefined {
  return COMMANDS.find(
    ({ id }) => id !== command && shortcuts[id].includes(binding),
  )?.id;
}

export function readShortcuts(value: string | null): Shortcuts {
  if (!value || value.length > 8192) return DEFAULT_SHORTCUTS;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return DEFAULT_SHORTCUTS;
    const result = { ...DEFAULT_SHORTCUTS };
    const used = new Set<string>();
    for (const { id } of COMMANDS) {
      const binding: unknown = Object.hasOwn(parsed, id)
        ? (parsed as Record<string, unknown>)[id]
        : DEFAULT_SHORTCUTS[id];
      if (!Array.isArray(binding) || binding.length > 2)
        return DEFAULT_SHORTCUTS;
      for (const item of binding) {
        if (typeof item !== "string" || bindingError(item) || used.has(item))
          return DEFAULT_SHORTCUTS;
        used.add(item);
      }
      result[id] = [...binding];
    }
    return result;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function eventBinding(event: KeyboardEvent): string | null {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    event.getModifierState("AltGraph") ||
    ["Dead", "Process", "Unidentified"].includes(event.key)
  )
    return null;
  // Use physical positions so Option and non-US layouts do not change a binding.
  const code = event.code;
  if (!KEY.test(code)) return null;
  return [
    ...(event.ctrlKey ? ["Control"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    code,
  ].join("+");
}

export function matchCommand(
  shortcuts: Shortcuts,
  event: KeyboardEvent,
): Command | undefined {
  const binding = eventBinding(event);
  return binding
    ? COMMANDS.find(({ id }) => shortcuts[id].includes(binding))?.id
    : undefined;
}

export function formatBinding(binding: string): string {
  return binding
    .replace(/Key([A-Z])|Digit([0-9])/g, (_, letter, digit) => letter ?? digit)
    .replace("Control", "Ctrl")
    .replace("Meta", "Command")
    .replace("Alt", binding.includes("Meta") ? "Option" : "Alt")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓");
}

export function shortcutTitle(
  shortcuts: Shortcuts,
  command: Command,
  label: string,
): string {
  const keys = shortcuts[command].map(formatBinding).join(" or ");
  return keys ? `${label} (${keys})` : label;
}

export function ariaShortcuts(
  shortcuts: Shortcuts,
  command: Command,
): string | undefined {
  return (
    shortcuts[command]
      .map((binding) =>
        binding.replace(
          /Key([A-Z])|Digit([0-9])/g,
          (_, letter, digit) => letter ?? digit,
        ),
      )
      .join(" ") || undefined
  );
}
