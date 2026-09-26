import { Samples } from "./metrics";

/** Local keyboard echo observed in DOM, followed by a frame opportunity. */
export class EchoProbe {
  private observer: MutationObserver;
  private pending: {
    key: string;
    marker: string;
    start: number;
    domAt: number | null;
    output: boolean;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private frame: number | null = null;
  private stopped = false;
  private sequence = 0;
  private completed = 0;
  private dispatchToDOM = new Samples(1024);
  private dispatchToFrame = new Samples(1024);

  constructor(
    private element: HTMLElement,
    private write: (text: string) => void,
    private fail: (error: string) => void,
  ) {
    this.observer = new MutationObserver(() => this.observe());
    this.observer.observe(element.querySelector(".term-grid")!, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    element.addEventListener("keydown", this.keydown, true);
    element.addEventListener("focusout", this.blur);
  }

  private blur = () => {
    if (!this.stopped) this.fail("Terminal input lost focus");
  };

  private keydown = (event: KeyboardEvent) => {
    if (this.stopped) return;
    // Capture before WTerm's input listener. Driver/OS delivery time is excluded.
    const start = performance.now();
    if (
      !event.isTrusted ||
      !/^[a-z]$/.test(event.key) ||
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.target !== this.element.querySelector("textarea")
    ) {
      this.fail(
        "Expected a trusted, unmodified lowercase key on terminal input",
      );
      return;
    }
    if (this.pending || this.sequence >= 1024) {
      this.fail("Overlapping input probes or sample limit exceeded");
      return;
    }
    this.sequence++;
    this.pending = {
      key: event.key,
      marker: `echo ${String(this.sequence).padStart(4, "0")}: ${event.key}`,
      start,
      domAt: null,
      output: false,
    };
    this.timer = setTimeout(
      () => this.fail("Keyboard echo did not reach a frame within 5 seconds"),
      5000,
    );
  };

  input(data: string): void {
    if (this.stopped) return;
    const probe = this.pending;
    if (!probe || probe.output || data !== probe.key) {
      this.fail("Terminal input did not match the pending keyboard probe");
      return;
    }
    probe.output = true;
    // A synchronous local echo exercises WTerm input, parsing and rendering.
    this.write(`\x1b7\x1b[1;1H\x1b[0m\x1b[2K${probe.marker}\x1b8`);
  }

  private matches(): boolean {
    return (
      this.element
        .querySelector(".term-row:not(.term-scrollback-row)")
        ?.textContent?.trimEnd() === this.pending?.marker
    );
  }

  private observe(): void {
    const probe = this.pending;
    if (
      this.stopped ||
      !probe?.output ||
      this.frame !== null ||
      !this.matches()
    )
      return;
    probe.domAt = performance.now();
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      if (this.stopped || this.pending !== probe) return;
      if (document.visibilityState !== "visible" || !this.matches()) {
        this.fail("Keyboard echo disappeared before its frame opportunity");
        return;
      }
      const elapsed = performance.now() - probe.start;
      if (elapsed >= 5000) {
        this.fail("Keyboard echo did not reach a frame within 5 seconds");
        return;
      }
      this.dispatchToDOM.add(probe.domAt! - probe.start);
      this.dispatchToFrame.add(elapsed);
      this.completed++;
      this.pending = null;
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = null;
    });
  }

  progress() {
    return {
      started: this.sequence,
      completed: this.completed,
      pending: !!this.pending,
    };
  }

  snapshot() {
    return {
      ...this.progress(),
      keyDispatchToDOMMs: this.dispatchToDOM.report(),
      keyDispatchToFrameMs: this.dispatchToFrame.report(),
    };
  }

  stop(): void {
    this.stopped = true;
    this.observer.disconnect();
    this.element.removeEventListener("keydown", this.keydown, true);
    this.element.removeEventListener("focusout", this.blur);
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.timer = this.frame = null;
  }
}
