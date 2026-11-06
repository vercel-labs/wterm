import { describe, expect, it } from "vitest";
import { WorkerCore } from "../worker-core.js";

/** Stands in for a Worker: records posts and lets the test dispatch events. */
class FakeWorker extends EventTarget {
  posted: unknown[] = [];
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {}
}

describe("WorkerCore", () => {
  it("rejects load when the worker fails before replying", async () => {
    const worker = new FakeWorker();
    const loading = WorkerCore.load({ worker: worker as unknown as Worker });
    const error = new Event("error") as Event & { message: string };
    error.message = "boom";
    worker.dispatchEvent(error);
    await expect(loading).rejects.toThrow("boom");
  });

  it("resolves load once the worker reports ready", async () => {
    const worker = new FakeWorker();
    const loading = WorkerCore.load({ worker: worker as unknown as Worker });
    expect(worker.posted).toEqual([{ t: "load", wasmUrl: undefined }]);
    worker.dispatchEvent(new MessageEvent("message", { data: { t: "ready" } }));
    await expect(loading).resolves.toBeInstanceOf(WorkerCore);
  });

  it("forwards a copy of the host theme colors to the worker", async () => {
    const worker = new FakeWorker();
    const loading = WorkerCore.load({ worker: worker as unknown as Worker });
    worker.dispatchEvent(new MessageEvent("message", { data: { t: "ready" } }));
    const core = await loading;
    const palette = Array.from({ length: 16 }, (_, i) => i);
    const colors = { foreground: 1, background: 2, cursor: 3, palette };
    core.setThemeColors(colors);
    palette[0] = 0xffffff;
    expect(worker.posted.at(-1)).toEqual({
      t: "theme",
      colors: {
        foreground: 1,
        background: 2,
        cursor: 3,
        palette: Array.from({ length: 16 }, (_, i) => i),
      },
    });
  });
});
