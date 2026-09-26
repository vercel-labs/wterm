import type { TerminalCore } from "@wterm/core";
import { Renderer, type WTerm } from "@wterm/dom";
import { EchoProbe } from "./echo-probe";
import {
  INPUT_COLS,
  INPUT_ROWS,
  inputFixture,
  type InputWorkload,
} from "./input-workloads";
import { Samples } from "./metrics";

export interface InputSession {
  terminal: WTerm;
  core: TerminalCore;
  memory: WebAssembly.Memory;
}

export class InputRun {
  private probe: EchoProbe;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private deadline: ReturnType<typeof setTimeout>;
  private stopped = false;
  private startedAt = performance.now();
  private saved: InputReport | null = null;
  private originalRender = Renderer.prototype.render;
  private stats;
  private before;

  constructor(
    private sessions: InputSession[],
    private workload: InputWorkload,
    private expectedProbes: number,
  ) {
    // Generation and memory sampling precede the timed producer/probe interval.
    const chunks = inputFixture(workload);
    this.stats = sessions.map(() => ({
      outputBytes: 0,
      writes: 0,
      writeMs: new Samples(8192),
      renderMs: new Samples(8192),
    }));
    this.before = this.resources();
    const original = this.originalRender;
    const byCore = new Map(
      sessions.map(({ core }, i) => [core, this.stats[i]]),
    );
    Renderer.prototype.render = function (...args) {
      const start = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        byCore.get(args[0])?.renderMs.add(performance.now() - start);
      }
    };
    const active = sessions[0].terminal;
    this.probe = new EchoProbe(
      active.element,
      (text) => active.write(text),
      this.abort,
    );
    active.onData = (data) => this.probe.input(data);
    document.addEventListener("visibilitychange", this.visibility);
    this.startedAt = performance.now();
    this.deadline = setTimeout(
      () => this.abort("Input run exceeded 90 seconds"),
      90_000,
    );
    if (document.visibilityState !== "visible")
      this.abort("Benchmark page became hidden");
    if (document.activeElement !== active.element.querySelector("textarea"))
      this.abort("Terminal input is not focused");
    if (this.stopped || !chunks.length) return;
    sessions.forEach(({ terminal }, i) => {
      const produce = () => {
        if (this.stopped) return;
        try {
          const stats = this.stats[i];
          const chunk = chunks[stats.writes % chunks.length];
          const start = performance.now();
          terminal.write(chunk);
          stats.writeMs.add(performance.now() - start);
          stats.outputBytes += chunk.byteLength;
          stats.writes++;
          // Independent bounded tasks allow keyboard dispatch between sessions.
          this.timers[i] = setTimeout(produce, 0);
        } catch (error) {
          this.abort(String(error));
        }
      };
      this.timers[i] = setTimeout(produce, 0);
    });
  }

  private visibility = () => {
    if (document.visibilityState !== "visible")
      this.abort("Benchmark page became hidden");
  };

  progress() {
    return {
      ...this.probe.progress(),
      outputStarted:
        this.workload === "idle" ||
        this.stats.every((stats) => stats.writes > 0),
      stopped: this.stopped,
      error: this.saved?.error ?? null,
    };
  }

  finish(): InputReport {
    if (!this.stopped) {
      const probe = this.probe.progress();
      if (
        probe.pending ||
        probe.completed !== this.expectedProbes ||
        probe.started !== this.expectedProbes
      )
        this.abort("Input run ended without all expected echoes");
      else if (
        this.workload !== "idle" &&
        this.stats.some((stats) => !stats.writes)
      )
        this.abort("A session received no output");
      else this.stop(null);
    }
    return this.saved!;
  }

  abort = (error: string) => {
    if (!this.stopped) this.stop(error);
  };

  report(): InputReport | null {
    return this.saved;
  }

  private resources() {
    return {
      jsHeapUsedBytes:
        (performance as Performance & { memory?: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? null,
      sessions: this.sessions.map(({ terminal, core, memory }) => ({
        wasmLinearMemoryBytes: memory.buffer.byteLength,
        domElements: terminal.element.querySelectorAll("*").length,
        mountedRows: terminal.element.querySelectorAll(".term-row").length,
        retainedHistoryRows: core.getScrollbackCount(),
      })),
    };
  }

  private stop(error: string | null) {
    this.stopped = true;
    const elapsedMs = performance.now() - this.startedAt;
    this.timers.forEach(clearTimeout);
    clearTimeout(this.deadline);
    this.probe.stop();
    document.removeEventListener("visibilitychange", this.visibility);
    Renderer.prototype.render = this.originalRender;
    this.sessions.forEach(({ terminal }) => {
      terminal.onData = () => {};
      terminal.setRenderingPaused(true);
    });
    const style = getComputedStyle(this.sessions[0].terminal.element);
    this.saved = {
      schemaVersion: 1,
      source: "local-keyboard-echo",
      complete: error === null,
      error,
      workload: this.workload,
      expectedProbes: this.expectedProbes,
      elapsedMs,
      probes: this.probe.snapshot(),
      sessions: this.stats.map((stats, i) => ({
        active: i === 0,
        outputBytes: stats.outputBytes,
        writes: stats.writes,
        deliveredMiBPerSecond:
          stats.outputBytes / (1024 * 1024) / (elapsedMs / 1000),
        writeMs: stats.writeMs.report(),
        renderMs: stats.renderMs.report(),
        // Read parsed state only after timing stops, including hidden sessions.
        finalScreen: Array.from({ length: INPUT_ROWS }, (_, row) =>
          Array.from({ length: INPUT_COLS }, (_, col) => {
            const cell = this.sessions[i].core.getCell(row, col);
            return cell.chars ?? String.fromCodePoint(cell.char || 32);
          })
            .join("")
            .trimEnd(),
        ),
      })),
      resources: { before: this.before, after: this.resources() },
      environment: {
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        cellWidth: style.getPropertyValue("--term-cell-width"),
        rowHeight: style.getPropertyValue("--term-row-height"),
        visibility: document.visibilityState,
      },
    };
  }
}

export interface InputReport {
  schemaVersion: number;
  source: "local-keyboard-echo";
  complete: boolean;
  error: string | null;
  workload: InputWorkload;
  expectedProbes: number;
  elapsedMs: number;
  probes: ReturnType<EchoProbe["snapshot"]>;
  sessions: {
    active: boolean;
    outputBytes: number;
    writes: number;
    deliveredMiBPerSecond: number;
    writeMs: ReturnType<Samples["report"]>;
    renderMs: ReturnType<Samples["report"]>;
    finalScreen: string[];
  }[];
  resources: {
    before: ReturnType<InputRun["resources"]>;
    after: ReturnType<InputRun["resources"]>;
  };
  environment: {
    userAgent: string;
    hardwareConcurrency: number;
    devicePixelRatio: number;
    viewport: { width: number; height: number };
    fontFamily: string;
    fontSize: string;
    cellWidth: string;
    rowHeight: string;
    visibility: string;
  };
}
