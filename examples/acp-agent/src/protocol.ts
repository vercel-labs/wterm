// Messages between server.ts and the page. The server turns ACP session
// updates into these, so the page never parses ACP itself.

export type ToolKind = "execute" | "read" | "edit" | "other";

export type CommandMeta = {
  exitCode?: number | null;
  durationMs?: number;
};

export type UiEvent =
  | { type: "session"; agent: string; ansi: boolean }
  | { type: "user"; text: string }
  | { type: "message"; id: string; text: string }
  | { type: "thought"; id: string; text: string }
  | {
      type: "tool";
      id: string;
      kind: ToolKind;
      title: string;
      name: string;
      summary: string;
      input: Record<string, unknown>;
    }
  | { type: "output"; id: string; data: string }
  | {
      type: "done";
      id: string;
      status: "completed" | "failed";
      meta?: CommandMeta;
    }
  | {
      type: "permission";
      requestId: number;
      toolId?: string;
      title: string;
      options: { optionId: string; name: string; kind: string }[];
    }
  | { type: "title"; text: string }
  | { type: "turn"; stopReason: string }
  | { type: "error"; text: string };

export type ClientEvent =
  | { type: "prompt"; text: string }
  | { type: "permission"; requestId: number; optionId: string }
  | { type: "cancel" };
