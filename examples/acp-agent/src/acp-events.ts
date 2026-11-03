// Turns ACP `session/update` payloads into UiEvents.
import type { CommandMeta, ToolKind, UiEvent } from "./protocol";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";

/** Terminals expect CR before LF; tool output uses bare LF. */
export const toTerminal = (text: string) => text.replace(/\r?\n/g, "\r\n");

type Content = {
  type: string;
  content?: { type: string; text?: string };
  path?: string;
  oldText?: string | null;
  newText?: string;
};

/** A line diff that keeps two lines of context around the change. */
export function renderDiff(
  path: string,
  before: string,
  after: string,
): string {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const out = [`${CYAN}${path}${RESET}`];
  for (const line of a.slice(Math.max(0, head - 2), head))
    out.push(`${DIM}  ${line}${RESET}`);
  for (const line of a.slice(head, a.length - tail))
    out.push(`${RED}- ${line}${RESET}`);
  for (const line of b.slice(head, b.length - tail))
    out.push(`${GREEN}+ ${line}${RESET}`);
  for (const line of b.slice(b.length - tail, b.length - tail + 2))
    out.push(`${DIM}  ${line}${RESET}`);
  return out.join("\n");
}

/** Text and `diff` content blocks, as terminal-ready text. */
function renderContent(blocks: Content[] | undefined): string {
  return (blocks ?? [])
    .map((block) => {
      if (block.type === "content" && block.content?.type === "text")
        return block.content.text ?? "";
      if (block.type === "diff" && block.path)
        return `${renderDiff(block.path, block.oldText ?? "", block.newText ?? "")}\n`;
      return "";
    })
    .join("");
}

const kindOf = (kind: unknown): ToolKind =>
  kind === "execute" || kind === "read" || kind === "edit" ? kind : "other";

function summaryOf(kind: ToolKind, input: Record<string, unknown>): string {
  if (kind === "execute" && typeof input.command === "string")
    return input.command;
  if (typeof input.path === "string") return input.path;
  if (typeof input.file_path === "string") return input.file_path;
  return "";
}

/** fx reports exit code and duration in `command_result`; other agents may not. */
function metaOf(raw: unknown): CommandMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return {
    exitCode: r.exit_code as number | null | undefined,
    durationMs: r.duration_ms as number | undefined,
  };
}

type Tool = { kind: ToolKind; streamed: boolean; finished: boolean };

export class AcpEvents {
  private tools = new Map<string, Tool>();
  // Consecutive chunks of the same kind form one block. `messageId` is
  // optional in ACP, so blocks also separate messages that lack it.
  private block = 0;
  private open: "message" | "thought" | null = null;

  /** Ends the current block, for example when the user sends a prompt. */
  endBlock(): void {
    this.open = null;
  }

  private blockId(kind: "message" | "thought"): string {
    if (this.open !== kind) {
      this.block++;
      this.open = kind;
    }
    return `${kind}-${this.block}`;
  }

  update(u: Record<string, unknown>): UiEvent[] {
    const kind = u.sessionUpdate;
    const text = (u.content as { text?: string } | undefined)?.text ?? "";
    if (kind === "agent_message_chunk") {
      const block = this.blockId("message");
      const id = typeof u.messageId === "string" ? u.messageId : block;
      return text ? [{ type: "message", id, text }] : [];
    }
    if (kind === "agent_thought_chunk") {
      const id = this.blockId("thought");
      return text ? [{ type: "thought", id, text }] : [];
    }
    this.open = null;
    if (kind === "tool_call") return this.toolCall(u);
    if (kind === "tool_call_update") return this.toolUpdate(u);
    if (kind === "session_info_update" && typeof u.title === "string")
      return [{ type: "title", text: u.title }];
    return [];
  }

  private toolCall(u: Record<string, unknown>): UiEvent[] {
    const id = String(u.toolCallId);
    const kind = kindOf(u.kind);
    const input = (u.rawInput as Record<string, unknown>) ?? {};
    this.tools.set(id, { kind, streamed: false, finished: false });
    const events: UiEvent[] = [
      {
        type: "tool",
        id,
        kind,
        title: String(u.title ?? u.name ?? "Tool"),
        name: String(u.name ?? u.title ?? "tool"),
        summary: summaryOf(kind, input),
        input,
      },
    ];
    // Edit tools that send old and new strings get a diff right away.
    if (
      kind === "edit" &&
      typeof input.old_string === "string" &&
      typeof input.new_string === "string"
    ) {
      const path = summaryOf(kind, input);
      events.push({
        type: "output",
        id,
        data: toTerminal(renderDiff(path, input.old_string, input.new_string)),
      });
      this.tools.get(id)!.streamed = true;
    }
    return events;
  }

  private toolUpdate(u: Record<string, unknown>): UiEvent[] {
    const id = String(u.toolCallId);
    const tool = this.tools.get(id);
    if (!tool || tool.finished) return [];
    const text = renderContent(u.content as Content[] | undefined);
    if (u.status === "in_progress") {
      if (!text) return [];
      tool.streamed = true;
      return [{ type: "output", id, data: toTerminal(text) }];
    }
    if (u.status !== "completed" && u.status !== "failed") return [];
    tool.finished = true;
    const events: UiEvent[] = [];
    // A tool that streamed already shows its output; the final text is a
    // summary. Read results are for the model, so their cards stay compact.
    if (!tool.streamed && text && tool.kind !== "read")
      events.push({ type: "output", id, data: toTerminal(text) });
    events.push({
      type: "done",
      id,
      status: u.status,
      meta: metaOf(u.command_result),
    });
    return events;
  }
}
