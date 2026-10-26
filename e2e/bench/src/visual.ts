import { WTerm } from "@wterm/dom";

const SAMPLE =
  "\x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m \x1b[4munderline\x1b[0m \x1b[9mstrike\x1b[0m \x1b[2mdim\x1b[0m \x1b[7mreverse\x1b[0m\r\n" +
  Array.from(
    { length: 16 },
    (_, i) => `\x1b[${i < 8 ? 30 + i : 82 + i}m██`,
  ).join("") +
  "\x1b[0m " +
  Array.from({ length: 8 }, (_, i) => `\x1b[48;5;${196 + i}m  `).join("") +
  "\x1b[0m\r\n" +
  "wide: 界界語 emoji: \u{1F600}\u{1F680} box: ┌─┬┐ │x│ └─┴┘\r\n" +
  "blocks: ▀▄█▌▐░▒▓▖▗▘▝▁▂▃▄▅▆▇\r\n" +
  "\x1b[38;2;255;100;0mtruecolor fg\x1b[0m \x1b[48;2;20;60;160m truecolor bg \x1b[0m \x1b[1;4;38;5;45mbold+ul 256\x1b[0m\r\n" +
  "$ cursor here";

export async function visual(mode: "dom" | "webgl"): Promise<void> {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  host.style.cssText = "width:640px;height:200px";
  document.body.append(host);
  const term = new WTerm(host, {
    cols: 64,
    rows: 8,
    autoResize: false,
    renderer: mode,
    onData: () => {},
  });
  await term.init();
  (window as unknown as { term: WTerm }).term = term;
  term.write(SAMPLE);
  term.focus?.();
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );
}
(window as unknown as { visual: typeof visual }).visual = visual;
