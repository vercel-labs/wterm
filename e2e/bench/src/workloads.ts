// Deterministic terminal workloads. Each returns the bytes for update `n`.

export type Workload = (n: number) => string;

/** Precomputes `count` updates so generating bytes stays out of the measurement. */
export function cycle(
  key: string,
  make: () => Workload,
  count = 240,
): Workload {
  let frames = cache.get(key);
  if (!frames) {
    const gen = make();
    frames = Array.from({ length: count }, (_, i) => gen(i));
    cache.set(key, frames);
  }
  const f = frames;
  return (n) => f[n % count];
}

const cache = new Map<string, string[]>();

/**
 * Truecolor upper-half blocks; every cell changes every update. Colors are
 * quantized and SGR is emitted only when it changes, as real programs do.
 */
export function halfblock(cols: number, rows: number): Workload {
  return (n) => {
    const t = n * 0.08;
    let out = "\x1b[H";
    for (let y = 0; y < rows; y++) {
      if (y > 0) out += "\r\n";
      let lastFg = "";
      let lastBg = "";
      for (let x = 0; x < cols; x++) {
        const fg = plasma(x, y * 2, t);
        const bg = plasma(x, y * 2 + 1, t);
        if (fg !== lastFg) out += `\x1b[38;2;${fg}m`;
        if (bg !== lastBg) out += `\x1b[48;2;${bg}m`;
        lastFg = fg;
        lastBg = bg;
        out += "▀";
      }
    }
    return out + "\x1b[0m";
  };
}

function plasma(x: number, y: number, t: number): string {
  const v =
    Math.sin(x * 0.11 + t) +
    Math.sin(y * 0.07 - t) +
    Math.sin((x + y) * 0.05 + t * 0.7);
  const q = (c: number) => ((Math.sin(v * Math.PI + c) * 127 + 128) & 0xf0) | 8;
  return `${q(0)};${q(2.1)};${q(4.2)}`;
}

const VERBS = ["Read", "Edit", "Bash", "Grep", "Write"];

/** Agent-style log streaming: a few styled lines appended per update. */
export function logs(id: number): Workload {
  return (n) => {
    let out = "";
    for (let i = 0; i < 2; i++) {
      const step = n * 2 + i;
      const verb = VERBS[step % VERBS.length];
      out += `\x1b[32m✓\x1b[0m \x1b[1magent-${id}\x1b[0m step ${step} \x1b[36m${verb}\x1b[0m src/module-${step % 97}.ts \x1b[2m${(step * 7) % 1000}ms\x1b[0m\r\n`;
    }
    return out;
  };
}

/**
 * Full-frame Kitty graphics, like a game streaming video into the terminal:
 * one 640x400 RGB image per update, transmitted in protocol-sized chunks.
 */
export function kitty(cols: number, rows: number): Workload {
  const w = 640;
  const h = 400;
  return (n) => {
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0, i = 0; y < h; y++)
      for (let x = 0; x < w; x++, i += 3) {
        rgb[i] = (x + n * 4) & 255;
        rgb[i + 1] = (y + n * 2) & 255;
        rgb[i + 2] = ((x ^ y) + n) & 255;
      }
    let bin = "";
    for (let i = 0; i < rgb.length; i += 0x8000)
      bin += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
    const data = btoa(bin);
    // Games draw on the alternate screen, where images take no scrollback flow.
    let out = "\x1b[?1049h\x1b[H";
    for (let i = 0; i < data.length; i += 4096) {
      const more = i + 4096 < data.length ? 1 : 0;
      const head =
        i === 0
          ? `a=T,f=24,s=${w},v=${h},c=${cols},r=${rows},i=1,q=2,m=${more}`
          : `m=${more}`;
      out += `\x1b_G${head};${data.slice(i, i + 4096)}\x1b\\`;
    }
    return out;
  };
}
