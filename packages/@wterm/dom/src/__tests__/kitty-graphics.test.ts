import { describe, it, expect } from "vitest";
import {
  KittyGraphicsFilter,
  MAX_PENDING_CHUNKS,
  type StreamEvent,
} from "../kitty-graphics.js";

const enc = new TextEncoder();

function feed(filter: KittyGraphicsFilter, s: string): StreamEvent[] {
  return filter.push(enc.encode(s));
}

function textOf(ev: StreamEvent): string {
  if (ev.type !== "text") throw new Error("expected text event");
  return new TextDecoder().decode(ev.bytes);
}

function base64(bytes: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

describe("KittyGraphicsFilter", () => {
  it("passes through plain text untouched", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "hello world");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("hello world");
  });

  it("passes through normal CSI escape sequences", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "\x1b[1;31mred\x1b[0m");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("\x1b[1;31mred\x1b[0m");
  });

  it("passes through non-Kitty APC sequences", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "before\x1b_Xfoo\x1b\\after");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("before\x1b_Xfoo\x1b\\after");
  });

  it("extracts a single complete Kitty graphics APC and emits text around it", () => {
    const f = new KittyGraphicsFilter();
    const png = base64([1, 2, 3, 4]);
    const events = feed(f, `prefix\x1b_Ga=T,f=100,i=1;${png}\x1b\\suffix`);

    expect(events).toHaveLength(3);
    expect(textOf(events[0])).toBe("prefix");
    expect(events[1].type).toBe("graphics");
    if (events[1].type === "graphics") {
      expect(events[1].event.control.a).toBe("T");
      expect(events[1].event.control.f).toBe(100);
      expect(events[1].event.control.i).toBe(1);
      expect(Array.from(events[1].event.data)).toEqual([1, 2, 3, 4]);
    }
    expect(textOf(events[2])).toBe("suffix");
  });

  it("accepts BEL as a terminator", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, `\x1b_Ga=t,i=5,f=100;${base64([9])}\x07tail`);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("graphics");
    expect(textOf(events[1])).toBe("tail");
  });

  it("handles a chunked transfer split across writes", () => {
    const f = new KittyGraphicsFilter();
    // Real apps base64-encode the full payload, then split the base64 stream
    // into fixed-size chunks. Intermediate chunks therefore have no `=` pad.
    const full = base64([10, 11, 12, 13, 14, 15, 16, 17]);
    const split = Math.floor(full.length / 2);
    const chunkA = full.slice(0, split);
    const chunkB = full.slice(split);

    const first = feed(f, `\x1b_Ga=T,f=100,i=42,m=1;${chunkA}\x1b\\`);
    expect(first).toHaveLength(0);

    const second = feed(f, `\x1b_Gi=42,m=0;${chunkB}\x1b\\done`);
    expect(second).toHaveLength(2);
    expect(second[0].type).toBe("graphics");
    if (second[0].type === "graphics") {
      expect(second[0].event.control.i).toBe(42);
      expect(Array.from(second[0].event.data)).toEqual([
        10, 11, 12, 13, 14, 15, 16, 17,
      ]);
    }
    expect(textOf(second[1])).toBe("done");
  });

  it("handles APC bytes split across multiple push calls", () => {
    const f = new KittyGraphicsFilter();
    const png = base64([1, 2]);
    const full = `\x1b_Ga=T,f=100,i=7;${png}\x1b\\`;
    const events: StreamEvent[] = [];
    for (const ch of full) events.push(...feed(f, ch));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("graphics");
    if (events[0].type === "graphics") {
      expect(Array.from(events[0].event.data)).toEqual([1, 2]);
    }
  });

  it("emits a delete action with no payload", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "\x1b_Ga=d,d=a\x1b\\");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("graphics");
    if (events[0].type === "graphics") {
      expect(events[0].event.control.a).toBe("d");
      expect(events[0].event.control.d).toBe("a");
      expect(events[0].event.data.length).toBe(0);
    }
  });

  it("does not consume `\\x1b` followed by something other than `_`", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "\x1b[A");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("\x1b[A");
  });

  it("does not consume `\\x1b_` followed by something other than `G`", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "\x1b_Q;foo\x1b\\");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("\x1b_Q;foo\x1b\\");
  });

  it("coalesces contiguous text runs in a single push", () => {
    const f = new KittyGraphicsFilter();
    const events = feed(f, "a\x1bb\x1b_c");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("a\x1bb\x1b_c");
  });

  it("reset clears in-flight state", () => {
    const f = new KittyGraphicsFilter();
    feed(f, "\x1b_Ga=T,f=100,i=99;abc"); // never terminates
    f.reset();
    const events = feed(f, "hi");
    expect(events).toHaveLength(1);
    expect(textOf(events[0])).toBe("hi");
  });

  it("silently drops an APC whose payload is invalid base64", () => {
    const f = new KittyGraphicsFilter();
    // "abcde" survives the strip regex but has length 5 — invalid base64
    // (length must be a multiple of 4), so `atob` throws.
    const events = feed(f, `before\x1b_Ga=T,f=100,i=1;abcde\x1b\\after`);
    // No graphics event emitted; surrounding text still passes through.
    const graphics = events.filter((e) => e.type === "graphics");
    expect(graphics).toHaveLength(0);
    const text = events
      .filter((e) => e.type === "text")
      .map(textOf)
      .join("");
    expect(text).toBe("beforeafter");
  });

  it("evicts the oldest pending chunk when exceeding the chunk-count cap", () => {
    const f = new KittyGraphicsFilter();
    // Start MAX_PENDING_CHUNKS + 1 distinct in-flight transfers (m=1, never closed).
    for (let i = 0; i < MAX_PENDING_CHUNKS + 1; i++) {
      const events = feed(
        f,
        `\x1b_Ga=T,f=100,i=${100 + i},m=1;${base64([i])}\x1b\\`,
      );
      // Each chunk-with-more emits nothing.
      expect(events).toHaveLength(0);
    }
    // The oldest entry (i=100) was evicted. Closing it now should not produce
    // a graphics event because no pending entry remains and m=0 is treated as
    // a fresh standalone APC with empty payload.
    const closeOldest = feed(f, `\x1b_Gi=100,m=0;\x1b\\`);
    const oldestGraphics = closeOldest.filter((e) => e.type === "graphics");
    // A fresh standalone APC still emits one graphics event (with empty data),
    // but it must NOT contain the originally-buffered byte.
    expect(oldestGraphics).toHaveLength(1);
    if (oldestGraphics[0].type === "graphics") {
      expect(Array.from(oldestGraphics[0].event.data)).toEqual([]);
    }
    // The newest entry (i=100 + MAX_PENDING_CHUNKS) is still pending — closing
    // it should yield the originally-buffered byte.
    const newestId = 100 + MAX_PENDING_CHUNKS;
    const closeNewest = feed(f, `\x1b_Gi=${newestId},m=0;\x1b\\`);
    expect(closeNewest).toHaveLength(1);
    if (closeNewest[0].type === "graphics") {
      expect(Array.from(closeNewest[0].event.data)).toEqual([
        MAX_PENDING_CHUNKS,
      ]);
    }
  });
});
