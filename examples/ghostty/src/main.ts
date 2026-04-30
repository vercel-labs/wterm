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
    "Type anything to echo it back:\r\n",
);
