"use client";

import { useRef } from "react";
import { DIVIDER_SIZE, type Divider } from "../lib/workspace-layout";

export function PaneDivider({
  divider,
  onResize,
}: {
  divider: Divider;
  onResize: (id: string, ratio: number) => void;
}) {
  const drag = useRef<{ pointer: number; offset: number } | null>(null);
  const horizontal = divider.direction === "right";
  const clamp = (value: number) =>
    Math.max(divider.min, Math.min(divider.max, value));
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={
        horizontal ? "Resize panes horizontally" : "Resize panes vertically"
      }
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-controls={divider.primary.map((id) => `pane-${id}`).join(" ")}
      aria-valuemin={Math.round(divider.min * 100)}
      aria-valuemax={Math.round(divider.max * 100)}
      aria-valuenow={Math.round(divider.ratio * 100)}
      title="Drag to resize. Arrow keys adjust; Enter centers."
      className={`absolute z-10 touch-none rounded bg-[var(--workspace-border)] hover:bg-[var(--workspace-focus)] focus-visible:bg-[var(--workspace-focus)] focus-visible:outline-2 focus-visible:outline-[var(--workspace-focus)] ${horizontal ? "cursor-col-resize" : "cursor-row-resize"}`}
      style={{
        left: divider.left,
        top: divider.top,
        width: divider.width,
        height: divider.height,
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        drag.current = {
          pointer: event.pointerId,
          offset: horizontal
            ? event.clientX - rect.left
            : event.clientY - rect.top,
        };
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const canvas =
          event.currentTarget.parentElement!.getBoundingClientRect();
        const position = horizontal
          ? event.clientX - canvas.left - divider.container.left
          : event.clientY - canvas.top - divider.container.top;
        const size = horizontal
          ? divider.container.width
          : divider.container.height;
        onResize(
          divider.id,
          clamp((position - drag.current.offset) / (size - DIVIDER_SIZE)),
        );
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.nativeEvent.isComposing
        )
          return;
        let next: number;
        if (event.key === (horizontal ? "ArrowLeft" : "ArrowUp"))
          next = divider.ratio - 0.05;
        else if (event.key === (horizontal ? "ArrowRight" : "ArrowDown"))
          next = divider.ratio + 0.05;
        else if (event.key === "Home") next = divider.min;
        else if (event.key === "End") next = divider.max;
        else if (event.key === "Enter") next = 0.5;
        else return;
        event.preventDefault();
        event.stopPropagation();
        onResize(divider.id, clamp(next));
      }}
    />
  );
}
