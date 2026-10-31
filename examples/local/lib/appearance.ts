import type { TerminalThemeColors } from "@wterm/core";

export const APPEARANCE_KEY = "wterm.local.appearance.v1";
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 32;
export interface Appearance {
  theme: "system" | "dark" | "light";
  fontSize: number;
}
export const DEFAULT_APPEARANCE: Appearance = { theme: "system", fontSize: 14 };

export function readAppearance(value: string | null): Appearance {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_APPEARANCE };
    const settings = parsed as Record<string, unknown>;
    return {
      theme:
        settings.theme === "dark" || settings.theme === "light"
          ? settings.theme
          : "system",
      fontSize:
        typeof settings.fontSize === "number" &&
        Number.isInteger(settings.fontSize) &&
        settings.fontSize >= MIN_FONT_SIZE &&
        settings.fontSize <= MAX_FONT_SIZE
          ? settings.fontSize
          : DEFAULT_APPEARANCE.fontSize,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export const TERMINAL_COLORS: Record<"dark" | "light", TerminalThemeColors> = {
  dark: {
    foreground: 0xd4d4d4,
    background: 0x000000,
    cursor: 0xaeafad,
    palette: [
      0x1e1e1e, 0xf44747, 0x6a9955, 0xd7ba7d, 0x569cd6, 0xc586c0, 0x4ec9b0,
      0xd4d4d4, 0x808080, 0xf44747, 0x6a9955, 0xd7ba7d, 0x569cd6, 0xc586c0,
      0x4ec9b0, 0xffffff,
    ],
  },
  light: {
    foreground: 0x383a42,
    background: 0xfafafa,
    cursor: 0x526fff,
    palette: [
      0x383a42, 0xe45649, 0x50a14f, 0xc18401, 0x4078f2, 0xa626a4, 0x0184bc,
      0xa0a1a7, 0x4f525e, 0xe45649, 0x50a14f, 0xc18401, 0x4078f2, 0xa626a4,
      0x0184bc, 0xffffff,
    ],
  },
};
