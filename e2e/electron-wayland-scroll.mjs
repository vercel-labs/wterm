import { app, BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const dpr = Number(process.env.WTERM_DPR);
const expected = process.env.WTERM_EXPECT;
const caseType = process.env.WTERM_CASE ?? "geometry";
const height = Number(process.env.WTERM_HEIGHT);
const artifactDir = path.resolve(
  process.env.WTERM_ARTIFACT_DIR ?? "e2e/artifacts/fractional-scroll",
);
const url = process.env.WTERM_URL ?? "http://127.0.0.1:4173/?debug";
const events = [];
let stage = "startup";

function mark(nextStage) {
  stage = nextStage;
  const event = { stage, at: new Date().toISOString() };
  events.push(event);
  process.stderr.write(`[wterm-wayland] ${event.at} ${stage}\n`);
}

async function withTimeout(promise, label, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function writeArtifact(result) {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    path.join(artifactDir, `dpr-${dpr}-${expected}-${caseType}-${height}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  await new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, resolve);
  });
}

if (!Number.isFinite(dpr)) throw new Error("WTERM_DPR must be numeric");
if (expected !== "broken" && expected !== "fixed") {
  throw new Error("WTERM_EXPECT must be broken or fixed");
}
if (caseType !== "geometry" && caseType !== "history") {
  throw new Error("WTERM_CASE must be geometry or history");
}
if (!Number.isInteger(height) || height <= 0) {
  throw new Error("WTERM_HEIGHT must be a positive integer");
}
if (caseType === "history" && expected !== "fixed") {
  throw new Error("history cases only support WTERM_EXPECT=fixed");
}
if (process.env.DISPLAY) {
  throw new Error(`DISPLAY must be unset, received ${process.env.DISPLAY}`);
}
if (!process.env.WAYLAND_DISPLAY) {
  throw new Error("WAYLAND_DISPLAY must be set");
}

app.commandLine.appendSwitch("enable-features", "UseOzonePlatform");
app.commandLine.appendSwitch("ozone-platform", "wayland");
app.commandLine.appendSwitch("force-device-scale-factor", String(dpr));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => {});

async function waitForReady(window, caseName) {
  const separator = url.includes("?") ? "&" : "?";
  await withTimeout(
    window.loadURL(
      `${url}${separator}waylandCase=${encodeURIComponent(caseName)}`,
    ),
    "fixture navigation",
    20000,
  );
  await withTimeout(
    window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const deadline = performance.now() + 15000;
        const check = () => {
          if (
            globalThis.__wterm &&
            document.querySelector(".term-row")?.textContent?.includes("Welcome")
          ) {
            resolve();
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error("wterm fixture did not become ready"));
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      })
    `),
    "fixture readiness",
    20000,
  );
}

async function runCase(window, height) {
  mark(`geometry:${height}:resize`);
  window.setContentSize(997, height);
  mark(`geometry:${height}:ready`);
  await waitForReady(window, `geometry-${height}`);
  mark(`geometry:${height}:exercise`);
  return await withTimeout(
    window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const term = globalThis.__wterm;
          const element = term.element;
          const initialHeight = element.scrollHeight;
          const trace = [];
          const record = (type, details = {}) => {
            trace.push({
              type,
              at: performance.now(),
              scrollTop: element.scrollTop,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              following: term._shouldScrollToBottom,
              pending: term._programmaticScrollTop,
              ...details,
            });
            if (trace.length > 300) trace.shift();
          };
          const originalSetScrollTop = term._setScrollTop.bind(term);
          term._setScrollTop = (value) => {
            record("set:before", { requested: value });
            originalSetScrollTop(value);
            record("set:after", { requested: value });
          };
          element.addEventListener("scroll", () => record("scroll"));
          record("initial");
          let written = 0;
          const deadline = performance.now() + 15000;
          const stream = () => {
            record("write:before", { written });
            term.write(
              Array.from(
                { length: 10 },
                (_, index) =>
                  "line " +
                  String(written + index + 1).padStart(4, "0") +
                  "\\r\\n",
              ).join(""),
            );
            written += 10;
            record("write:after", { written });
            if (written < 400) {
              requestAnimationFrame(stream);
              return;
            }
            requestAnimationFrame(check);
          };
          const check = () => {
            if (element.scrollHeight > initialHeight + 1000) {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const rect = element.getBoundingClientRect();
                  resolve({
                    height: ${height},
                    dpr: devicePixelRatio,
                    rectHeight: rect.height,
                    scrollHeight: element.scrollHeight,
                    clientHeight: element.clientHeight,
                    scrollTop: element.scrollTop,
                    gap:
                      element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight,
                    following: term._shouldScrollToBottom,
                    pending: term._programmaticScrollTop,
                    trace,
                  });
                }),
              );
              return;
            }
            if (performance.now() > deadline) {
              reject(new Error("terminal output did not render"));
              return;
            }
            requestAnimationFrame(check);
          };
          stream();
        })
      `),
    `geometry case ${height}`,
    20000,
  );
}

async function runHistoryCase(window, caseHeight) {
  mark("history:resize");
  window.setContentSize(997, caseHeight);
  mark("history:ready");
  await waitForReady(window, "history");
  mark("history:exercise");
  return await withTimeout(
    window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
          const term = globalThis.__wterm;
          const element = term.element;
          term.write(
            Array.from(
              { length: 400 },
              (_, index) => "history " + String(index + 1).padStart(4, "0") + "\\r\\n",
            ).join(""),
          );
          const deadline = performance.now() + 15000;
          const waitForBottom = () => {
            const gap =
              element.scrollHeight - element.scrollTop - element.clientHeight;
            if (element.scrollHeight > 1000 && gap <= 1) {
              element.scrollTop = Math.max(0, element.scrollTop - 300);
              requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                  const held = element.scrollTop;
                  term.write(
                    Array.from(
                      { length: 100 },
                      (_, index) =>
                        "more " + String(index + 1).padStart(4, "0") + "\\r\\n",
                    ).join(""),
                  );
                  requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                      resolve({
                        held,
                        after: element.scrollTop,
                        following: term._shouldScrollToBottom,
                      });
                    }),
                  );
                }),
              );
              return;
            }
            if (performance.now() > deadline) {
              reject(new Error("history fixture did not reach the bottom"));
              return;
            }
            requestAnimationFrame(waitForBottom);
          };
          waitForBottom();
        })
      `),
    "history case",
    20000,
  );
}

async function run() {
  mark("electron:ready");
  await withTimeout(app.whenReady(), "Electron readiness", 20000);

  const versions = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    waylandDisplay: process.env.WAYLAND_DISPLAY,
    display: process.env.DISPLAY ?? null,
    expected,
    requestedDpr: dpr,
  };

  if (versions.electron !== "43.4.0") {
    throw new Error(`expected Electron 43.4.0, received ${versions.electron}`);
  }
  if (!versions.chrome.startsWith("150.")) {
    throw new Error(`expected Chromium 150, received ${versions.chrome}`);
  }

  const window = new BrowserWindow({
    width: 997,
    height,
    frame: false,
    show: true,
    useContentSize: true,
  });
  if (caseType === "history") {
    const history = await runHistoryCase(window, height);
    const failureMessage =
      Math.abs(history.after - history.held) > 1 || history.following
        ? "history position did not remain anchored during output"
        : null;
    return {
      versions,
      caseType,
      height,
      geometry: null,
      history,
      failureMessage,
      events,
    };
  }

  const geometry = await runCase(window, height);
  if (Math.abs(geometry.dpr - dpr) > 0.01) {
    throw new Error(`requested DPR ${dpr}, received ${geometry.dpr}`);
  }

  const failed = geometry.gap > 1 || geometry.following !== true;
  const failureMessage =
    expected === "broken"
      ? failed
        ? null
        : "baseline did not reproduce the fractional-scroll defect"
      : failed
        ? "fixed build failed the geometry case"
        : null;

  return {
    versions,
    caseType,
    height,
    geometry,
    history: null,
    failureMessage,
    events,
  };
}

async function main() {
  let exitCode = 0;
  try {
    const result = await withTimeout(run(), "Wayland probe", 240000);
    mark("artifact:write");
    await writeArtifact(result);
    if (result.failureMessage) {
      exitCode = 1;
    }
  } catch (error) {
    exitCode = 1;
    const failedStage = stage;
    mark("failure");
    const diagnostic = {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      stage: failedStage,
      requestedDpr: dpr,
      expected,
      caseType,
      height,
      events,
    };
    try {
      await writeArtifact(diagnostic);
    } catch (artifactError) {
      process.stderr.write(
        `[wterm-wayland] failed to write diagnostic: ${String(artifactError)}\n`,
      );
    }
  } finally {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    mark(`exit:${exitCode}`);
    app.exit(exitCode);
  }
}

void main();
