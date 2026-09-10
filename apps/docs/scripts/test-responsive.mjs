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
    footerTheme: rect([...document.querySelectorAll('footer label[for^="theme-switch-"]')].find(visible)),
    footerThemeGroup: rect(document.querySelector('footer input[id^="theme-switch-"]')?.closest('fieldset')),
    search: rect([...document.querySelectorAll('header button')].find(element => element.textContent.includes('Search') && visible(element))),
    github: rect([...document.querySelectorAll('header a[aria-label="GitHub repository"]')].find(visible)),
    actionGap: copy && heading ? copy.getBoundingClientRect().top - heading.getBoundingClientRect().bottom : null,
    tocOverlapsHeading: toc && visible(toc) && overlap(rect(toc), rect(heading)),
    triggers: triggers.map(element => ({
      location: element.closest('[data-docs-chat-launcher]') ? 'floating' : 'inline',
      box: rect(element),
      background: getComputedStyle(element).backgroundColor,
      primary: element.classList.contains('bg-gray-1000') && element.classList.contains('text-background-100'),
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
    browser("scroll", "down", "100000");
    evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
    );
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
        evaluate(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        );
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
          assert.equal(
            trigger.primary,
            true,
            `${label}: Ask AI is not primary`,
          );
          if (width < 640) {
            assert.ok(
              Math.abs((trigger.box.left + trigger.box.right) / 2 - width / 2) <
                1,
              `${label}: mobile launcher is not centered`,
            );
            if (position === "bottom") {
              assert.ok(data.footerTheme, `${label}: theme control missing`);
              assert.ok(
                Math.abs(
                  (trigger.box.top + trigger.box.bottom) / 2 -
                    (data.footerTheme.top + data.footerTheme.bottom) / 2,
                ) < 1,
                `${label}: launcher is not aligned with theme controls`,
              );
            }
          } else {
            const theme = data.footerThemeGroup;
            assert.ok(theme, `${label}: theme control missing`);
            const rightInset = (width - theme.right) * 0.8;
            const actualRight = width - trigger.box.right;
            assert.ok(
              actualRight >= rightInset - 1 &&
                actualRight <= width - theme.right + 1,
            );
            if (theme.top < 844) {
              assert.ok(
                Math.abs(trigger.box.right - theme.right) < 1,
                `${label}: launcher must align with the theme control at the footer`,
              );
            } else if (theme.top >= 924) {
              assert.ok(
                Math.abs(actualRight - rightInset) < 1,
                `${label}: desktop right margin must be reduced by 20% away from the footer`,
              );
            }
            const expectedBottom = Math.max(rightInset, 844 - theme.top + 16);
            assert.ok(
              Math.abs(844 - trigger.box.bottom - expectedBottom) < 1,
              `${label}: bottom must match the right inset unless avoiding footer controls`,
            );
          }
          assert.equal(
            trigger.location,
            "floating",
            `${label}: launcher is not floating`,
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
            trigger.box.height >= 40 && trigger.box.height <= 44,
            `${label}: unexpected launcher height`,
          );
          assert.ok(
            trigger.box.left >= 0 &&
              trigger.box.right <= width &&
              trigger.box.top >= 64 &&
              trigger.box.bottom <= 844 - (width < 640 ? 15 : 7),
            `${label}: launcher outside safe bounds`,
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
  for (const width of [1024, 1440, 1920]) {
    viewport(width);
    for (const distance of [160, 120, 80, 40, 0, 40, 80, 160]) {
      browser("scroll", "down", "100000");
      if (distance) browser("scroll", "up", String(distance));
      evaluate(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
      );
      const data = evaluate(measure);
      const trigger = data.triggers[0];
      const theme = data.footerThemeGroup;
      assert.ok(
        trigger && theme,
        `${width}/${distance}: docking elements missing`,
      );
      assert.equal(
        trigger.overlapsTheme,
        false,
        `${width}/${distance}: theme controls covered during docking`,
      );
      const rightInset = (width - theme.right) * 0.8;
      const actualRight = width - trigger.box.right;
      assert.ok(
        actualRight >= rightInset - 1 && actualRight <= width - theme.right + 1,
      );
      if (theme.top < 844) {
        assert.ok(
          Math.abs(trigger.box.right - theme.right) < 1,
          `${width}/${distance}: footer alignment missing`,
        );
      } else if (theme.top >= 924) {
        assert.ok(
          Math.abs(actualRight - rightInset) < 1,
          `${width}/${distance}: reduced margin not restored`,
        );
      }
      assert.ok(
        Math.abs(
          844 - trigger.box.bottom - Math.max(rightInset, 844 - theme.top + 16),
        ) < 1,
      );
      results.push({ interaction: "footer-docking", width, distance, ...data });
      if (distance === 0)
        browser("screenshot", resolve(output, `footer-docked-${width}.png`));
    }
  }
  for (const width of [390, 430, 639, 640, 800, 1024, 1440]) {
    viewport(width);
    browser("scroll", "up", "100000");
    browser("click", '[data-docs-chat-launcher] button[aria-label="Ask AI"]');
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
      const headerWidth = evaluate(
        "document.querySelector('header').getBoundingClientRect().width",
      );
      assert.ok(
        headerWidth >= 319,
        `${width}: chat leaves insufficient room for documentation`,
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
    assert.equal(
      evaluate("document.querySelectorAll('[data-docs-chat-launcher]').length"),
      0,
    );
    browser("click", `#${id} button[aria-label="Close panel"]`);
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
  viewport(1440);
  assert.equal(
    evaluate(
      "document.querySelectorAll('header [aria-label=\"Product navigation\"]').length",
    ),
    1,
  );
  viewport(390);
  browser("scroll", "up", "100000");
  browser("click", 'header [data-slot="mobile-menu-toggle"]');
  browser(
    "wait",
    "--fn",
    `document.querySelector('header [data-slot="mobile-menu-toggle"]')?.getAttribute('aria-expanded') === 'true'`,
  );
  assert.equal(
    evaluate(
      `[...document.querySelectorAll("header summary")].some(e => e.textContent.includes("Vercel OSS"))`,
    ),
    true,
  );
  browser("find", "role", "button", "click", "--name", "Search");
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
  browser("find", "role", "button", "click", "--name", "ESC");
  browser(
    "wait",
    "--fn",
    "!document.querySelector('[data-geistdocs-command-modal]')",
  );
  browser("click", 'header [data-slot="mobile-menu-toggle"]');
  viewport(1440);
  browser(
    "wait",
    "--fn",
    `document.querySelector('header [data-slot="mobile-menu-toggle"]')?.getAttribute('aria-expanded') === 'false' && getComputedStyle(document.body).overflow !== 'hidden'`,
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
