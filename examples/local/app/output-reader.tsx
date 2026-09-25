"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { BookOpen } from "lucide-react";
import type { WTerm } from "@wterm/dom";

export function OutputReader({
  terminal,
  name,
  active,
}: {
  terminal: RefObject<WTerm | null>;
  name: string;
  active: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const capture = useRef<AbortController | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const helpId = useId();

  useEffect(() => () => capture.current?.abort(), []);
  useEffect(() => {
    if (!active) dialog.current?.close();
  }, [active]);
  useEffect(() => {
    if (text === null || !input.current) return;
    input.current.setSelectionRange(0, 0);
    input.current.scrollTop = 0;
    input.current.scrollLeft = 0;
  }, [text]);

  const refresh = async () => {
    capture.current?.abort();
    const request = new AbortController();
    capture.current = request;
    setBusy(true);
    setStatus("Reading output…");
    try {
      if (!terminal.current) throw new Error("Terminal is not ready");
      const value = await terminal.current.readText({ signal: request.signal });
      if (request.signal.aborted) return;
      setText(value);
      setStatus("Output ready.");
    } catch (error) {
      if (request.signal.aborted) return;
      setStatus(
        error instanceof RangeError
          ? "There is too much output to read at once."
          : error instanceof DOMException && error.name === "AbortError"
            ? "Output changed while being read. Refresh to try again."
            : "Unable to read output. Refresh to try again.",
      );
    } finally {
      if (capture.current === request && !request.signal.aborted) {
        capture.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded px-2 py-1 text-[#aaa] hover:bg-[#222] hover:text-white"
        onClick={() => {
          dialog.current?.showModal();
          heading.current?.focus();
          void refresh();
        }}
      >
        <BookOpen size={14} aria-hidden="true" />
        Read output
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={helpId}
        className="m-auto w-[min(56rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-lg border border-[#444] bg-[#111] p-5 text-[#ededed] backdrop:bg-black/70"
        onClose={() => {
          if (dialog.current?.open) return;
          capture.current?.abort();
          capture.current = null;
          setText(null);
          setBusy(false);
          setStatus("");
        }}
      >
        <h2
          ref={heading}
          id={titleId}
          tabIndex={-1}
          className="text-base font-medium outline-none"
        >
          {name} output
        </h2>
        <p id={helpId} className="mt-2 text-sm leading-relaxed text-[#aaa]">
          Read and copy a snapshot of retained terminal output. New output
          appears only after Refresh. Close this view to return to the terminal.
        </p>
        <p role="status" className="my-3 min-h-5 text-sm text-[#aaa]">
          {status}
        </p>
        <textarea
          ref={input}
          aria-label={`${name} output text`}
          readOnly
          disabled={text === null}
          spellCheck={false}
          wrap="off"
          value={text ?? ""}
          className="block h-[min(55vh,32rem)] w-full resize-none rounded border border-[#444] bg-black p-3 font-mono text-sm leading-relaxed outline-none focus-visible:border-white"
        />
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button
            type="button"
            disabled={busy}
            onClick={() => void refresh()}
            className="rounded border border-[#555] px-3 py-2 hover:bg-[#222] disabled:opacity-40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-[#555] px-3 py-2 hover:bg-[#222]"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
