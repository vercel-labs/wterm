"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { WTerm } from "@wterm/dom";

export interface ClipboardWriteRequest {
  text: string;
}

export function ClipboardRequest({
  request,
  dismiss,
  terminal,
  name,
  active,
}: {
  request: ClipboardWriteRequest | null;
  dismiss: (request: ClipboardWriteRequest) => void;
  terminal: RefObject<WTerm | null>;
  name: string;
  active: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const attempt = useRef(0);
  const [snapshot, setSnapshot] = useState<ClipboardWriteRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const titleId = useId();
  const helpId = useId();

  useEffect(() => {
    if (!active) dialog.current?.close();
  }, [active]);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );

  const copy = async () => {
    if (!snapshot || busy) return;
    const current = ++attempt.current;
    setBusy(true);
    try {
      // Call during the button gesture; never read the browser clipboard.
      await navigator.clipboard.writeText(snapshot.text);
      if (attempt.current !== current || !dialog.current?.open) return;
      dismiss(snapshot);
      setStatus(snapshot.text ? "Copied." : "Clipboard cleared.");
    } catch {
      if (attempt.current !== current || !dialog.current?.open) return;
      setStatus(
        "Copy failed. Select the text and use your browser’s Copy action.",
      );
    } finally {
      if (attempt.current === current) setBusy(false);
    }
  };

  return (
    <>
      {request && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 py-2 text-xs text-[var(--workspace-muted)]">
          <span role="status">
            An application wants to{" "}
            {request.text ? "copy text" : "clear the clipboard"}.
          </span>
          <button
            type="button"
            aria-haspopup="dialog"
            className="shrink-0 underline hover:text-[var(--workspace-fg)]"
            onClick={() => {
              attempt.current++;
              setBusy(false);
              setSnapshot(request);
              setStatus("");
              dialog.current?.showModal();
              heading.current?.focus();
            }}
          >
            Review clipboard request
          </button>
          <button
            type="button"
            className="shrink-0 underline hover:text-[var(--workspace-fg)]"
            onClick={() => {
              dismiss(request);
              terminal.current?.focus();
            }}
            aria-label="Dismiss clipboard request"
          >
            Dismiss
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        aria-describedby={helpId}
        className="m-auto w-[min(48rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-lg border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5 text-[var(--workspace-fg)] backdrop:bg-black/70"
        onClose={() => {
          if (dialog.current?.open) return;
          attempt.current++;
          if (snapshot) dismiss(snapshot);
          setSnapshot(null);
          setBusy(false);
          setStatus("");
          if (active) terminal.current?.focus();
        }}
      >
        <h2
          ref={heading}
          id={titleId}
          tabIndex={-1}
          className="text-base font-medium outline-none"
        >
          {name} clipboard request
        </h2>
        <p
          id={helpId}
          className="mt-2 text-sm leading-relaxed text-[var(--workspace-muted)]"
        >
          {snapshot?.text
            ? "Review the application’s text before replacing your clipboard. New requests do not change this preview."
            : "The application wants to replace your clipboard with empty text."}
        </p>
        <textarea
          aria-label="Requested clipboard text"
          readOnly
          spellCheck={false}
          wrap="off"
          value={snapshot?.text ?? ""}
          className="mt-3 block h-[min(40vh,20rem)] w-full resize-none rounded border border-[var(--workspace-border)] bg-[var(--workspace-bg)] p-3 font-mono text-sm leading-relaxed outline-none focus-visible:border-[var(--workspace-focus)]"
        />
        <p
          role="status"
          className="my-3 min-h-5 text-sm text-[var(--workspace-muted)]"
        >
          {status}
        </p>
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button
            type="button"
            disabled={busy || !snapshot}
            onClick={() => void copy()}
            className="rounded border border-[var(--workspace-border)] px-3 py-2 hover:bg-[var(--workspace-hover)] disabled:opacity-40"
          >
            {snapshot?.text ? "Copy" : "Clear clipboard"}
          </button>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded border border-[var(--workspace-border)] px-3 py-2 hover:bg-[var(--workspace-hover)]"
          >
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
