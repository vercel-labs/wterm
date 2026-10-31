"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Keyboard } from "lucide-react";
import {
  COMMANDS,
  DEFAULT_SHORTCUTS,
  SHORTCUTS_KEY,
  bindingError,
  conflictingCommand,
  eventBinding,
  formatBinding,
  readShortcuts,
  type Command,
  type Shortcuts,
} from "../lib/shortcuts";

function createShortcutStore() {
  type Snapshot = { shortcuts: Shortcuts; saved: boolean };
  let snapshot: Snapshot | null = null;
  let storage: Storage | null = null;
  const listeners = new Set<() => void>();
  const getSnapshot = (): Snapshot => {
    if (snapshot) return snapshot;
    let shortcuts = DEFAULT_SHORTCUTS,
      saved = true;
    try {
      storage = localStorage;
      shortcuts = readShortcuts(storage.getItem(SHORTCUTS_KEY));
    } catch {
      saved = false;
    }
    return (snapshot = { shortcuts, saved });
  };
  const publish = (shortcuts: Shortcuts, saved: boolean) => {
    snapshot = { shortcuts, saved };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      getSnapshot();
      const changed = (event: StorageEvent) => {
        if (
          storage &&
          event.storageArea === storage &&
          (event.key === null || event.key === SHORTCUTS_KEY)
        )
          publish(readShortcuts(event.newValue), true);
      };
      window.addEventListener("storage", changed);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", changed);
      };
    },
    update(shortcuts: Shortcuts) {
      let saved = true;
      try {
        localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(shortcuts));
      } catch {
        saved = false;
      }
      publish(shortcuts, saved);
    },
  };
}
const serverSnapshot = () => null;
export function useShortcuts() {
  const [store] = useState(createShortcutStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot,
  );
  return {
    shortcuts: snapshot?.shortcuts ?? DEFAULT_SHORTCUTS,
    saved: snapshot?.saved ?? true,
    update: store.update,
  };
}

export function ShortcutSettings({
  shortcuts,
  saved,
  update,
}: {
  shortcuts: Shortcuts;
  saved: boolean;
  update: (value: Shortcuts) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const composing = useRef(false);
  const [recording, setRecording] = useState<Command | null>(null);
  const [message, setMessage] = useState("");
  const title = useId();
  const help = useId();
  const close = () => {
    dialog.current?.close();
    composing.current = false;
    setRecording(null);
    setMessage("");
    opener.current?.focus({ preventScroll: true });
  };
  const buttonClass =
    "rounded border border-[var(--workspace-border)] px-3 py-2 hover:bg-[var(--workspace-hover)] disabled:opacity-40";
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded px-3 py-2 text-sm text-[var(--workspace-muted)] hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)]"
        onClick={() => {
          dialog.current?.showModal();
          heading.current?.focus();
        }}
      >
        <Keyboard size={16} aria-hidden="true" />
        Keyboard shortcuts
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={title}
        aria-describedby={help}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onCompositionStartCapture={() => {
          composing.current = true;
        }}
        onCompositionEndCapture={() => {
          composing.current = false;
        }}
        onKeyDownCapture={(event) => {
          if (!recording) return;
          if (event.key === "Tab") {
            setRecording(null);
            setMessage("");
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            setRecording(null);
            setMessage("Shortcut change canceled.");
            return;
          }
          if (event.repeat || composing.current) return;
          const binding = eventBinding(event.nativeEvent);
          if (!binding) return;
          const error = bindingError(binding);
          const conflict = conflictingCommand(shortcuts, recording, binding);
          if (error || conflict) {
            setMessage(
              error ??
                `Already assigned to ${COMMANDS.find(({ id }) => id === conflict)!.label}. Clear that binding first.`,
            );
            return;
          }
          update({ ...shortcuts, [recording]: [binding] });
          setMessage(
            `${COMMANDS.find(({ id }) => id === recording)!.label}: ${formatBinding(binding)}.`,
          );
          setRecording(null);
        }}
        className="m-auto w-[min(42rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-0 text-[var(--workspace-fg)] backdrop:bg-black/70"
      >
        <div className="flex max-h-[calc(100vh-2rem)] flex-col">
          <div className="shrink-0 px-5 pt-5">
            <h2
              ref={heading}
              tabIndex={-1}
              id={title}
              className="text-base font-medium outline-none"
            >
              Keyboard shortcuts
            </h2>
            <p id={help} className="mt-2 text-sm text-[var(--workspace-muted)]">
              Choose Change, then press a shortcut with Control or Command.
              Escape cancels recording. Shortcuts use physical key positions and
              work from terminal input; Find and New also work from workspace
              buttons. Browser and OS shortcuts may be unavailable.
            </p>
          </div>
          <ul className="mt-4 min-h-0 overflow-y-auto divide-y divide-[var(--workspace-border)] px-5">
            {COMMANDS.map(({ id, label }) => (
              <li
                key={id}
                className="flex flex-wrap items-center gap-2 py-3 text-sm"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <span className="block">{label}</span>
                  <span className="mt-1 block text-xs text-[var(--workspace-muted)]">
                    {recording === id
                      ? "Press a shortcut…"
                      : shortcuts[id].map(formatBinding).join(" or ") ||
                        "Not assigned"}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`Change shortcut for ${label}`}
                  aria-pressed={recording === id}
                  className={buttonClass}
                  onClick={() => {
                    setRecording(id);
                    setMessage(`Recording ${label}. Press Escape to cancel.`);
                  }}
                  onBlur={() => {
                    if (recording === id) {
                      setRecording(null);
                      setMessage("Shortcut change canceled.");
                    }
                  }}
                >
                  Change
                </button>
                <button
                  type="button"
                  aria-label={`Clear shortcut for ${label}`}
                  disabled={!shortcuts[id].length}
                  className={buttonClass}
                  onClick={() => {
                    update({ ...shortcuts, [id]: [] });
                    setRecording(null);
                    setMessage(`${label}: shortcut cleared.`);
                  }}
                >
                  Clear
                </button>
              </li>
            ))}
          </ul>
          <div className="shrink-0 border-t border-[var(--workspace-border)] px-5 pb-5">
            <p
              role="status"
              aria-live="polite"
              className="mt-3 min-h-10 text-sm text-[var(--workspace-muted)]"
            >
              {message}{" "}
              {saved
                ? "Saved in this browser."
                : "Changes apply now, but this browser could not save them."}
            </p>
            <div className="mt-2 flex justify-end gap-3 text-sm">
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  update(DEFAULT_SHORTCUTS);
                  setRecording(null);
                  setMessage("Default shortcuts restored.");
                }}
              >
                Reset defaults
              </button>
              <button type="button" className={buttonClass} onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
