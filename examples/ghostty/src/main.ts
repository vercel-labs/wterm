import { WTerm } from "@wterm/dom";
import { GhosttyCore } from "@wterm/ghostty";
import "@wterm/dom/css";

const el = document.getElementById("terminal")!;

const core = await GhosttyCore.load();
const term = new WTerm(el, { core });

await term.init();

term.write(
  "\x1b[1;36mwterm\x1b[0m powered by \x1b[1;35mlibghostty\x1b[0m 🚀\r\n\r\n" +
    "Full VT emulation • Kitty protocols • Unicode grapheme clusters\r\n\r\n" +
    "Direct Kitty image output:\r\n",
);

// A tiny direct RGB Kitty Graphics Protocol demonstration. The image is kept
// in the terminal core as decoded pixels and the DOM renderer paints it in a
// separate, pointer-transparent canvas layer.
const pixels = new Uint8Array(16 * 16 * 3);
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const offset = (y * 16 + x) * 3;
    const stripe = (x + y) % 2 === 0;
    pixels[offset] = stripe ? 255 : 36;
    pixels[offset + 1] = stripe ? 92 : 220;
    pixels[offset + 2] = stripe ? 48 : 255;
  }
}
const encoded = btoa(String.fromCharCode(...pixels));
term.write(`\x1b_Ga=T,f=24,s=16,v=16,i=1,c=16,r=8;${encoded}\x1b\\`);

term.write("\r\n\r\nType anything to echo it back:\r\n");
