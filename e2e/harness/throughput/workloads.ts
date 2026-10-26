const encoder = new TextEncoder();

/** Deterministic truecolor plasma, two vertical pixels per cell, every cell changes per frame. */
export function halfblockFrame(
  cols: number,
  rows: number,
  n: number,
): Uint8Array {
  const t = n / 30;
  let out = "\x1b[?25l\x1b[H";
  let fg = "";
  let bg = "";
  const px = (x: number, y: number) => {
    const v =
      Math.sin(x / 7 + t) +
      Math.sin(y / 5 - t * 1.3) +
      Math.sin((x + y) / 11 + t * 0.7);
    const noise = (x * 31 + y * 17 + n * 13) & 15;
    const r = Math.round(120 + 120 * Math.sin(v)) + noise;
    const g = Math.round(120 + 120 * Math.sin(v + 2.1)) + noise;
    const b = Math.round(120 + 120 * Math.sin(v + 4.2)) + noise;
    return `${r};${g};${b}`;
  };
  for (let y = 0; y < rows; y++) {
    if (y) out += "\r\n";
    for (let x = 0; x < cols; x++) {
      const top = px(x, y * 2);
      const bottom = px(x, y * 2 + 1);
      if (top !== fg && bottom !== bg)
        out += `\x1b[38;2;${top};48;2;${bottom}m`;
      else if (top !== fg) out += `\x1b[38;2;${top}m`;
      else if (bottom !== bg) out += `\x1b[48;2;${bottom}m`;
      fg = top;
      bg = bottom;
      out += "▀";
    }
  }
  return encoder.encode(out + "\x1b[0m");
}

const LEVELS = [
  "\x1b[38;2;143;184;255m● Read",
  "\x1b[38;2;142;224;160m  ✓",
  "\x1b[38;2;255;204;102m  ↻",
  "\x1b[38;2;232;224;214m   ",
];

/** Two colored log lines plus a status bar redrawn with cursor save and restore. */
export function logUpdate(id: number, n: number, rows: number): Uint8Array {
  let out = "";
  for (let k = 0; k < 2; k++)
    out += `\r\n${LEVELS[(n + k) % 4]}\x1b[0m agent-${id} step ${n * 2 + k} · src/module-${(n + k) % 37}.ts · ${(n * 7919) % 997} ms`;
  return encoder.encode(
    `${out}\x1b7\x1b[${rows};1H\x1b[48;2;42;29;20m\x1b[38;2;255;176;102m agent-${id} · ${n} updates \x1b[K\x1b[0m\x1b8`,
  );
}

/** Mixed static content used for the pixel comparison. */
export function mixedScreen(): string {
  const lines = [
    "\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m \x1b[4munderline\x1b[0m \x1b[9mstrike\x1b[0m \x1b[2mdim\x1b[0m \x1b[7mreverse\x1b[0m",
    "\x1b[31mred\x1b[32m green\x1b[33m yellow\x1b[34m blue\x1b[35m magenta\x1b[36m cyan\x1b[0m \x1b[41m bg-red \x1b[44m bg-blue \x1b[0m",
    "\x1b[38;5;208m256-orange\x1b[48;5;22m on green\x1b[0m \x1b[38;2;255;100;200mtruecolor\x1b[48;2;20;40;80m on navy \x1b[0m",
    "┌───┬───┐ ╭──╮ ╔══╗  wide: 界界 \u{1f600} éà",
    "│ a │ b │ ╰──╯ ╚══╝  blocks: ▀▄█▌▐░▒▓▖▟",
    "└───┴───┘ \x1b[44m▀▀▀\x1b[0m\x1b[31;42m▄▄▄\x1b[0m\x1b[38;2;250;0;0;48;2;0;0;250m▀▄█░\x1b[0m",
    "\x1b[42m                                                  \x1b[0m full-width bg",
    "\x1b[4:3m\x1b[58;2;255;0;0mcurly red underline\x1b[0m \x1b]8;;https://example.com\x07a link\x1b]8;;\x07 end",
  ];
  return "\x1b[H\x1b[2J" + lines.join("\r\n") + "\r\n$ ";
}

/** Full-screen TUI dashboard: four background-colored panels with labels and value bars that change every frame. */
export function tuiFrame(cols: number, rows: number, n: number): Uint8Array {
  const panels = 4;
  const width = Math.floor(cols / panels);
  const bases = [
    [32, 36, 48],
    [40, 30, 38],
    [28, 42, 34],
    [44, 38, 26],
  ];
  let out = "\x1b[?25l\x1b[H";
  for (let y = 0; y < rows; y++) {
    if (y) out += "\r\n";
    for (let p = 0; p < panels; p++) {
      const [r, g, b] = bases[p];
      const shade = (y * 3 + p * 5) % 12;
      const bg = `${r + shade};${g + shade};${b + shade}`;
      const value = Math.round(
        (0.5 + 0.5 * Math.sin(n / 9 + y / 4 + p * 1.7)) * 100,
      );
      const label = ` ${["cpu", "mem", "net", "dsk"][p]}${String(y).padStart(2, "0")} ${String(value).padStart(3, " ")}% `;
      const barWidth = width - label.length - 1;
      const filled = Math.round((barWidth * value) / 100);
      const hue =
        value > 80 ? "255;96;96" : value > 50 ? "255;200;80" : "120;220;140";
      out += `\x1b[38;2;230;230;230;48;2;${bg}m${label}`;
      out += `\x1b[48;2;${hue}m${" ".repeat(filled)}`;
      out += `\x1b[48;2;${bg}m${" ".repeat(barWidth - filled)} `;
    }
    out += "\x1b[0m";
  }
  return encoder.encode(out + "\x1b[0m");
}
