"use client";

import { useId, useRef, useState, useSyncExternalStore } from "react";
import { Settings2 } from "lucide-react";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  readAppearance,
  type Appearance,
} from "../lib/appearance";

function createAppearanceStore() {
  type Snapshot = {
    appearance: Appearance;
    theme: "dark" | "light";
    saved: boolean;
  };
  let snapshot: Snapshot | null = null;
  let storage: Storage | null = null;
  const listeners = new Set<() => void>();
  const resolve = (appearance: Appearance) =>
    appearance.theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : appearance.theme;
  const getSnapshot = (): Snapshot => {
    if (snapshot) return snapshot;
    let appearance = { ...DEFAULT_APPEARANCE };
    let saved = true;
    try {
      storage = localStorage;
      appearance = readAppearance(storage.getItem(APPEARANCE_KEY));
    } catch {
      saved = false;
    }
    return (snapshot = { appearance, theme: resolve(appearance), saved });
  };
  const publish = (appearance: Appearance, saved: boolean) => {
    snapshot = { appearance, theme: resolve(appearance), saved };
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      const media = matchMedia("(prefers-color-scheme: dark)");
      const change = () => {
        const value = getSnapshot();
        if (value.theme !== resolve(value.appearance))
          publish(value.appearance, value.saved);
      };
      const changedStorage = (event: StorageEvent) => {
        if (
          storage &&
          event.storageArea === storage &&
          (event.key === null || event.key === APPEARANCE_KEY)
        )
          publish(readAppearance(event.newValue), true);
      };
      getSnapshot();
      change();
      media.addEventListener("change", change);
      window.addEventListener("storage", changedStorage);
      return () => {
        listeners.delete(listener);
        media.removeEventListener("change", change);
        window.removeEventListener("storage", changedStorage);
      };
    },
    update(appearance: Appearance) {
      let saved = true;
      try {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
      } catch {
        saved = false;
      }
      publish(appearance, saved);
    },
  };
}
const serverSnapshot = () => null;
export function useAppearance() {
  const [store] = useState(createAppearanceStore);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    serverSnapshot,
  );
  return {
    appearance: snapshot?.appearance ?? DEFAULT_APPEARANCE,
    theme: snapshot?.theme ?? "dark",
    saved: snapshot?.saved ?? true,
    ready: snapshot !== null,
    update: store.update,
  };
}

export function AppearanceSettings({
  appearance,
  saved,
  update,
}: {
  appearance: Appearance;
  saved: boolean;
  update: (next: Appearance) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const title = useId();
  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        className="flex items-center gap-2 rounded px-3 py-2 text-sm text-[var(--workspace-muted)] hover:bg-[var(--workspace-hover)] hover:text-[var(--workspace-fg)]"
        onClick={() => {
          dialog.current?.showModal();
          select.current?.focus();
        }}
      >
        <Settings2 size={16} aria-hidden="true" />
        Appearance
      </button>
      <dialog
        ref={dialog}
        onClose={() => {
          if (!dialog.current?.open)
            opener.current?.focus({ preventScroll: true });
        }}
        aria-labelledby={title}
        className="m-auto w-[min(24rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-auto rounded-lg border border-[var(--workspace-border)] bg-[var(--workspace-panel)] p-5 text-[var(--workspace-fg)] backdrop:bg-black/70"
      >
        <h2 id={title} className="text-base font-medium">
          Appearance
        </h2>
        <p className="mt-2 text-sm text-[var(--workspace-muted)]">
          Applies to every terminal pane.
        </p>
        <label className="mt-5 flex items-center justify-between gap-4 text-sm">
          Theme
          <select
            ref={select}
            value={appearance.theme}
            onChange={(event) =>
              update({
                ...appearance,
                theme: event.target.value as Appearance["theme"],
              })
            }
            className="rounded border border-[var(--workspace-border)] bg-[var(--workspace-bg)] px-2 py-1.5"
          >
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label className="mt-5 block text-sm">
          <span className="flex justify-between gap-4">
            <span>Font size</span>
            <span>{appearance.fontSize} px</span>
          </span>
          <input
            type="range"
            min={MIN_FONT_SIZE}
            max={MAX_FONT_SIZE}
            step={1}
            value={appearance.fontSize}
            onChange={(event) =>
              update({ ...appearance, fontSize: event.target.valueAsNumber })
            }
            className="mt-3 w-full"
          />
        </label>
        <p
          role="status"
          className="mt-4 min-h-10 text-sm text-[var(--workspace-muted)]"
        >
          {saved
            ? "Saved in this browser."
            : "Changes apply now, but this browser could not save them."}
        </p>
        <div className="mt-4 flex justify-end gap-3 text-sm">
          <button
            type="button"
            onClick={() => update({ ...DEFAULT_APPEARANCE })}
            className="rounded border border-[var(--workspace-border)] px-3 py-2 hover:bg-[var(--workspace-hover)]"
          >
            Reset defaults
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
