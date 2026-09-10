import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const url = process.env.DOCS_TEST_URL;
if (!url) throw new Error("Set DOCS_TEST_URL to the running docs site.");
const output = resolve(
  process.env.DOCS_ARTIFACT_DIR ?? "test-results/docs-responsive",
);
mkdirSync(output, { recursive: true });
const session = `wterm-responsive-${process.pid}`;
const results = [];
function invoke(args, input) {
  const result = JSON.parse(
    execFileSync("agent-browser", ["--session", session, "--json", ...args], {
      encoding: "utf8",
      input,
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  assert.equal(result.success, true, JSON.stringify(result.error));
  return result.data;
}
const browser = (...args) => invoke(args);
const evaluate = (js) => invoke(["eval", "--stdin"], js).result;
function settleAnimations(selector) {
  browser(
    "wait",
    "--fn",
    `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    return !!element && element.getAnimations({subtree:true}).every(animation => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity);
  })()`,
  );
}
function viewport(width, height = 844) {
  browser("set", "viewport", String(width), String(height));
  evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
  );
}
const measure = `(() => {
  const visible = element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width > 0 && box.height > 0 && box.top < innerHeight && box.bottom > 0 && style.visibility !== 'hidden';
  };
  const rect = element => element?.getBoundingClientRect().toJSON();
  const overlap = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const triggers = [...document.querySelectorAll('button[aria-label="Ask AI"]')].filter(visible);
  const themes = [...document.querySelectorAll('footer label[for^="theme-switch-"], #nd-page button[aria-pressed]')].filter(visible);
  const heading = document.querySelector('#nd-page h1');
  const copy = [...document.querySelectorAll('#nd-page button')].find(element => element.textContent.includes('Copy') && visible(element));
  const toc = document.querySelector('[data-mobile-toc-trigger]');
  return {
    width: innerWidth,
    containerWidth: document.querySelector('[data-geistdocs-container]').clientWidth,
    pageWidth: document.documentElement.scrollWidth,
    pageHeight: document.documentElement.scrollHeight,
    scrollY,
    heading: rect(heading),
    search: rect([...document.querySelectorAll('[data-header-actions] button')].find(element => element.textContent.includes('Search') && visible(element))),
    github: rect([...document.querySelectorAll('[data-header-actions] a[aria-label="GitHub repository"]')].find(visible)),
    actionGap: copy && heading ? copy.getBoundingClientRect().top - heading.getBoundingClientRect().bottom : null,
    tocOverlapsHeading: toc && visible(toc) && overlap(rect(toc), rect(heading)),
    triggers: triggers.map(element => ({
      location: element.closest('[data-wterm-header]') ? 'header' : 'floating',
      box: rect(element),
      navigationBox: rect(element.closest('[data-wterm-header]')),
      navigationBackground: getComputedStyle(element.closest('[data-wterm-header]')).backgroundColor,
      background: getComputedStyle(element).backgroundColor,
      borderWidth: parseFloat(getComputedStyle(element).borderTopWidth),
      overlapsTheme: themes.some(theme => overlap(rect(element), rect(theme))),
      overlapsHeading: overlap(rect(element), rect(heading)),
    })),
  };
})()`;

try {
  browser("open", url);
  browser("wait", "--text", "Features");
  evaluate("document.fonts.ready.then(() => true)");
  for (const theme of ["dark", "light"]) {
    viewport(1440, 900);
    browser("click", `footer label[for^="theme-switch-${theme}-"]`);
    browser(
      "wait",
      "--fn",
      `document.documentElement.classList.contains('${theme}')`,
    );
    for (const width of [
      320, 390, 430, 639, 640, 767, 768, 800, 960, 961, 1024, 1199, 1200, 1440,
    ]) {
      viewport(width);
      browser("scroll", "up", "100000");
      for (const position of ["top", "middle", "bottom"]) {
        if (position === "middle") browser("scroll", "down", "600");
        if (position === "bottom") browser("scroll", "down", "100000");
        const data = evaluate(measure);
        const label = `${theme}/${width}/${position}`;
        results.push({ theme, position, ...data });
        assert.ok(data.pageWidth <= width, `${label}: horizontal overflow`);
        assert.ok(
          data.triggers.length <= 1,
          `${label}: duplicate Ask AI launchers`,
        );
        assert.equal(
          Boolean(data.tocOverlapsHeading),
          false,
          `${label}: TOC overlaps title`,
        );
        if (position === "top") {
          assert.equal(data.triggers.length, 1, `${label}: Ask AI missing`);
          if (data.containerWidth < 1200)
            assert.ok(
              data.actionGap >= 16,
              `${label}: title/actions gap ${data.actionGap}`,
            );
        }
        for (const trigger of data.triggers) {
          assert.ok(
            trigger.borderWidth >= 1,
            `${label}: Ask AI is not outline`,
          );
          if (data.search) {
            assert.ok(
              data.search.right <= trigger.box.left,
              `${label}: Ask AI must follow Search`,
            );
            assert.equal(
              data.search.height,
              trigger.box.height,
              `${label}: header control heights differ`,
            );
            assert.ok(
              data.search.width <= 150,
              `${label}: Search is not compact`,
            );
          }
          if (data.github)
            assert.ok(
              trigger.box.right <= data.github.left,
              `${label}: Ask AI must precede GitHub`,
            );
          assert.notEqual(
            trigger.location,
            "floating",
            `${label}: floating launcher`,
          );
          assert.equal(
            trigger.overlapsTheme,
            false,
            `${label}: theme controls covered`,
          );
          assert.equal(
            trigger.overlapsHeading,
            false,
            `${label}: title covered`,
          );
          assert.notEqual(
            trigger.background,
            "rgba(0, 0, 0, 0)",
            `${label}: transparent launcher`,
          );
          assert.ok(
            trigger.box.height >= 32 && trigger.box.height <= 34,
            `${label}: header button is not compact`,
          );
          assert.notEqual(
            trigger.navigationBackground,
            "rgba(0, 0, 0, 0)",
            `${label}: transparent navigation bar`,
          );
          assert.ok(
            trigger.box.bottom <= trigger.navigationBox.bottom + 1 &&
              trigger.box.top >= trigger.navigationBox.top - 1,
            `${label}: launcher outside navigation bar`,
          );
        }
        if ([390, 768, 960, 1440].includes(width))
          browser(
            "screenshot",
            resolve(output, `${theme}-${width}-${position}.png`),
          );
      }
    }
  }
  for (const width of [390, 640, 800, 1024, 1440]) {
    viewport(width);
    browser("scroll", "up", "100000");
    browser("click", '[data-wterm-header] button[aria-label="Ask AI"]');
    const id = width >= 640 ? "wterm-chat-desktop" : "wterm-chat-mobile";
    browser(
      "wait",
      "--fn",
      `document.getElementById('${id}')?.getAttribute('aria-hidden') !== 'true' && document.getElementById('${id}')?.getBoundingClientRect().width > 0`,
    );
    browser(
      "wait",
      "--fn",
      `document.querySelector('#${id} .wterm-chat')?.innerText.includes('What is wterm')`,
    );
    if (width >= 640) {
      browser(
        "wait",
        "--fn",
        `Math.abs(parseFloat(getComputedStyle(document.body).paddingRight) - document.getElementById('wterm-chat-desktop').getBoundingClientRect().width) < 1`,
      );
      const header = evaluate(
        `({width:document.querySelector('[data-wterm-header]').getBoundingClientRect().width, brandRight:document.querySelector('[data-wterm-header] a[href="/"]').getBoundingClientRect().right, askLeft:document.querySelector('[data-wterm-header] button[aria-label="Ask AI"]').getBoundingClientRect().left})`,
      );
      assert.ok(
        header.width >= 319,
        `${width}: chat leaves insufficient room for documentation`,
      );
      assert.ok(
        header.brandRight + 8 <= header.askLeft,
        `${width}: open chat crowds the header`,
      );
    }
    const panel = evaluate(
      `({width:document.getElementById('${id}').getBoundingClientRect().width, terminals:[...document.querySelectorAll('.wterm-chat')].filter(element=>element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().left < innerWidth).length, pageWidth:document.documentElement.scrollWidth})`,
    );
    assert.equal(panel.terminals, 1, `${width}: duplicate chat terminals`);
    assert.ok(
      panel.pageWidth <= width,
      `${width}: open chat overflows viewport`,
    );
    if (width < 640)
      assert.ok(
        Math.abs(panel.width - width) <= 1,
        `${width}: chat is not full-screen`,
      );
    settleAnimations(`#${id}`);
    browser("screenshot", resolve(output, `chat-${width}.png`));
    browser("press", "Escape");
    browser(
      "wait",
      "--fn",
      `!document.querySelector('button[aria-label="Ask AI"][aria-expanded="true"]')`,
    );
    browser(
      "wait",
      "--fn",
      width < 640
        ? "!document.getElementById('wterm-chat-mobile')"
        : "document.getElementById('wterm-chat-desktop').getBoundingClientRect().left >= innerWidth - 1 && parseFloat(getComputedStyle(document.body).paddingRight) < 1",
    );
    results.push({ interaction: "chat-open-close", width, panel });
  }
  viewport(390);
  browser("scroll", "up", "100000");
  browser("click", '[data-wterm-header] button[aria-label="Open menu"]');
  browser(
    "wait",
    "--fn",
    `document.getElementById('wterm-header-menu')?.hidden === false`,
  );
  browser("click", "[data-header-menu-search] button");
  browser(
    "wait",
    "--fn",
    `[...document.querySelectorAll('input:not([type="radio"])')].some(input => input.getBoundingClientRect().height > 0)`,
  );
  browser(
    "find",
    "role",
    "textbox",
    "fill",
    "--name",
    "Search",
    "WebSocketTransport",
  );
  browser(
    "wait",
    "--fn",
    `[...document.querySelectorAll('[data-geistdocs-command-modal] button')].some(button => button.textContent.includes('API Reference'))`,
  );
  browser("press", "Escape");
  browser(
    "wait",
    "--fn",
    "!document.querySelector('[data-geistdocs-command-modal]')",
  );
  browser("click", '[data-wterm-header] button[aria-label="Open menu"]');
  viewport(1440);
  browser(
    "wait",
    "--fn",
    `document.getElementById('wterm-header-menu')?.hidden === true && getComputedStyle(document.body).overflow !== 'hidden'`,
  );
  viewport(390);
  browser("scroll", "up", "100000");
  browser("click", "[data-mobile-docs-bar] button");
  browser("wait", "--text", "Browse");
  settleAnimations('[role="dialog"]');
  browser("click", '[role="dialog"] a[href="/react"]');
  browser("wait", "--url", "**/react");
  browser(
    "wait",
    "--fn",
    `document.querySelector('#nd-page h1')?.textContent === 'React'`,
  );
  browser(
    "wait",
    "--fn",
    `!document.querySelector('[role="dialog"] a[href="/react"]')`,
  );
  browser("click", "[data-mobile-toc-trigger]");
  browser(
    "wait",
    "--fn",
    `Boolean(document.querySelector('[data-geistdocs-mobile-toc] a'))`,
  );
  settleAnimations("[data-geistdocs-mobile-toc]");
  browser("find", "first", "[data-geistdocs-mobile-toc] a", "click");
  browser("wait", "--fn", "location.hash.length > 1");
  assert.ok(evaluate("location.hash.length > 1"));
  results.push({
    interaction: "mobile-primary-menu-search-resize-docs-menu-toc",
    passed: true,
  });
  const errors = browser("errors").errors;
  assert.deepEqual(errors, []);
  console.log(
    `PASS: ${results.length} responsive states, mobile/tablet/desktop chat, zero browser errors.`,
  );
} finally {
  writeFileSync(
    resolve(output, "results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  browser("close");
}
