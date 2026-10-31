import type { Page } from "@playwright/test";
import { Samples } from "../src/metrics";

/** One clock in the automation process, including delivery and callback IPC. */
export class PtyInputDriver {
  private sequence = 0;
  private pending: {
    sequence: number;
    start: number;
    dom: boolean;
    resolve(): void;
    reject(error: Error): void;
  } | null = null;
  private dom = new Samples(1024);
  private frame = new Samples(1024);
  private failure: string | null = null;

  constructor(private page: Page) {}

  async install() {
    await this.page.exposeBinding("ptyInputObserved", (_source, event) => {
      if (event.error) {
        this.fail(event.error);
        return;
      }
      const pending = this.pending;
      if (
        !pending ||
        event.sequence !== pending.sequence ||
        !["dom", "frame"].includes(event.stage)
      ) {
        this.fail("Unexpected echo report");
        return;
      }
      const elapsed = performance.now() - pending.start;
      if (event.stage === "dom" && !pending.dom) {
        pending.dom = true;
        this.dom.add(elapsed);
      } else if (event.stage === "frame" && pending.dom) {
        this.frame.add(elapsed);
        this.pending = null;
        pending.resolve();
      } else this.fail("Echo reports arrived out of order");
    });
  }

  private fail(reason: string) {
    this.failure ??= reason;
    this.pending?.reject(new Error(reason));
    this.pending = null;
  }

  async press(key: string) {
    if (this.pending || this.failure || this.sequence >= 1024)
      throw new Error(this.failure ?? "Invalid driver probe");
    let timer: ReturnType<typeof setTimeout>;
    const observed = new Promise<void>((resolve, reject) => {
      // Set the start before sending the protocol command, not in a page task.
      this.pending = {
        sequence: ++this.sequence,
        start: performance.now(),
        dom: false,
        resolve,
        reject,
      };
      timer = setTimeout(
        () => this.fail("Driver did not receive the echo within 5 seconds"),
        5000,
      );
    });
    try {
      await Promise.all([this.page.keyboard.press(key), observed]);
    } catch (error) {
      this.fail(String(error));
      throw error;
    } finally {
      clearTimeout(timer!);
    }
  }

  report() {
    return {
      started: this.sequence,
      completed: this.frame.report().count,
      error: this.failure,
      requestToDOMReportMs: this.dom.report(),
      requestToFrameReportMs: this.frame.report(),
    };
  }
}
