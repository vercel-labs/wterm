import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const el = document.getElementById("terminal")!;

const core = await GhosttyCore.load();
const term = new WTerm(el, { core });
await term.init();

term.write(
  "\x1b[1;36mwterm\x1b[0m — \x1b[1;35mKitty graphics protocol\x1b[0m demo\r\n\r\n",
);

term.write(
  "PNG image transmitted via APC `\\x1b_G...` sequence and rendered\r\n" +
    "as an absolutely-positioned <img> overlay above the cell grid.\r\n\r\n",
);

const pngBytes = await drawSamplePng(200, 100);
const b64 = base64FromBytes(pngBytes);

// Chunked transfer: real apps split the base64 payload across multiple
// `m=1` chunks with a final `m=0`. Demo it here with 4 KiB chunks.
const CHUNK = 4096;
let offset = 0;
let first = true;
while (offset < b64.length) {
  const end = Math.min(offset + CHUNK, b64.length);
  const isLast = end >= b64.length;
  const slice = b64.slice(offset, end);
  const control = first
    ? `a=T,f=100,i=1,c=25,r=6,m=${isLast ? 0 : 1}`
    : `i=1,m=${isLast ? 0 : 1}`;
  term.write(`\x1b_G${control};${slice}\x1b\\`);
  offset = end;
  first = false;
}

term.write(
  "\r\n\x1b[2mYour PNG above. Press any key — input echoes.\x1b[0m\r\n",
);

async function drawSamplePng(w: number, h: number): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, "#ff7eb6");
  grad.addColorStop(0.5, "#be95ff");
  grad.addColorStop(1, "#33b1ff");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 28px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("wterm 🚀", w / 2, h / 2);

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function base64FromBytes(bytes: Uint8Array): string {
  let s = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    s += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + STEP, bytes.length)),
    );
  }
  return btoa(s);
}
