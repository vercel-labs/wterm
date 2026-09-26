import { randomBytes } from "node:crypto";
import { WebSocket } from "ws";
import { PtyOutput } from "./pty-output";
import {
  CONTROL_RESERVE,
  HANDSHAKE_MS,
  INPUT_LIMIT,
  OUTPUT_WINDOW,
  SESSION_GRACE_MS,
  SESSION_LIMIT,
  isResize,
  type ClientMessage,
} from "./terminal-protocol";

export type TerminalSize = Extract<ClientMessage, { type: "resize" }>;
export interface SessionPty {
  write(data: string): void;
  resize(size: TerminalSize): void;
  pause(): void;
  resume(): void;
  dispose(kill: boolean): void;
}
export type SpawnPty = (
  size: TerminalSize,
  events: {
    data(data: string | Uint8Array): void;
    exit(): void;
    cwd(path: string): void;
  },
) => SessionPty;

class TerminalSession {
  readonly token = randomBytes(32).toString("hex");
  private socket: WebSocket | null = null;
  private process: SessionPty | null = null;
  private started = false;
  private exited = false;
  private stopped = false;
  private cwd: string | null = null;
  private sentCwd: string | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private output: PtyOutput;

  constructor(
    private spawn: SpawnPty,
    private remove: () => void,
  ) {
    this.output = new PtyOutput({
      send: (data) => {
        if (this.socket?.readyState !== WebSocket.OPEN)
          throw new Error("Socket closed");
        this.socket.send(data);
      },
      bufferedAmount: () => this.socket?.bufferedAmount ?? OUTPUT_WINDOW,
      pause: () => this.process?.pause(),
      resume: () => this.process?.resume(),
      finish: () => this.close(1000, "Session ended"),
      fail: () => this.close(1013, "Output could not be kept in sync"),
      disconnect: () => this.detach(),
    });
    this.output.detach();
  }

  attach(socket: WebSocket, bytes: number, resumed: boolean): void {
    if (!this.output.canResume(bytes)) {
      socket.close(4409, "Output can no longer be restored");
      return;
    }
    // Fence the previous attachment before closing it. Its queued callbacks
    // cannot supply input, resize, acknowledgments, or close this session.
    const previous = this.socket;
    this.socket = null;
    this.output.detach();
    previous?.close(4001, "Session reattached");
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.socket = socket;
    this.sentCwd = null;
    socket.on("message", (raw) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        const message = JSON.parse(raw.toString());
        if (!message || typeof message !== "object") throw new Error();
        if (isResize(message)) {
          if (!this.started) {
            this.started = true;
            try {
              this.process = this.spawn(message, {
                data: (data) => this.output.push(data),
                exit: () => {
                  this.exited = true;
                  this.output.end();
                },
                cwd: (path) => {
                  this.cwd = path;
                  this.sendCwd();
                },
              });
              if (!this.socket) this.process.pause();
            } catch (error) {
              const detail =
                error instanceof Error ? error.message : String(error);
              console.error(`Failed to spawn PTY: ${detail}`);
              this.exited = true;
              this.output.push(`\r\nFailed to spawn shell: ${detail}\r\n`);
              this.output.end();
            }
          } else if (!this.exited) this.process?.resize(message);
        } else if (message.type === "ack") {
          this.output.acknowledge(message.bytes);
        } else if (
          message.type === "input" &&
          typeof message.data === "string" &&
          Buffer.byteLength(message.data) <= INPUT_LIMIT &&
          this.started
        ) {
          if (!this.exited) this.process?.write(message.data);
        } else if (message.type === "close") {
          this.close(1000, "Session closed");
        } else throw new Error();
      } catch {
        this.close(1002, "Invalid terminal message");
      }
    });
    socket.on("close", (code) => {
      if (this.socket !== socket) return;
      if (code === 1000) this.close(1000, "Session closed");
      else this.detach();
    });
    socket.on("error", () => {
      if (this.socket === socket) this.detach();
    });
    try {
      socket.send(
        JSON.stringify({ type: "ready", session: this.token, resumed }),
      );
      this.sendCwd();
      if (this.socket === socket) this.output.attach(bytes);
    } catch {
      this.detach();
    }
  }

  private sendCwd(): void {
    if (
      !this.cwd ||
      this.cwd === this.sentCwd ||
      this.socket?.readyState !== WebSocket.OPEN
    )
      return;
    const message = JSON.stringify({ type: "cwd", cwd: this.cwd });
    if (
      Buffer.byteLength(message) <= CONTROL_RESERVE &&
      this.socket.bufferedAmount <= OUTPUT_WINDOW
    ) {
      try {
        this.socket.send(message);
        this.sentCwd = this.cwd;
      } catch {
        this.detach();
      }
    }
  }

  private detach(): void {
    if (this.stopped || !this.socket) return;
    const socket = this.socket;
    this.socket = null;
    this.output.detach();
    socket.close(4000, "Connection interrupted");
    this.expiry = setTimeout(
      () => this.close(1000, "Session expired"),
      SESSION_GRACE_MS,
    );
  }

  close(code = 1000, reason = "Server stopped"): void {
    if (this.stopped) return;
    this.stopped = true;
    const socket = this.socket;
    this.socket = null;
    if (this.expiry !== null) clearTimeout(this.expiry);
    this.expiry = null;
    this.output.stop();
    this.process?.dispose(!this.exited);
    this.remove();
    socket?.close(code, reason);
  }
}

/** Tokens live only in the existing page; a new page starts a new terminal. */
export class TerminalSessions {
  private sessions = new Map<string, TerminalSession>();
  constructor(private spawn: SpawnPty) {}

  get size(): number {
    return this.sessions.size;
  }

  accept(socket: WebSocket): void {
    const timeout = setTimeout(
      () => socket.close(1002, "Missing terminal attachment"),
      HANDSHAKE_MS,
    );
    socket.once("close", () => clearTimeout(timeout));
    // An error can precede the attachment and must not be an unhandled event.
    socket.on("error", () => {});
    socket.once("message", (raw) => {
      clearTimeout(timeout);
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        const message = JSON.parse(raw.toString());
        if (
          message?.type !== "attach" ||
          !Number.isSafeInteger(message.bytes) ||
          message.bytes < 0
        )
          throw new Error();
        if (message.session === null && message.bytes === 0) {
          if (this.sessions.size >= SESSION_LIMIT) {
            socket.close(1013, "Too many terminal sessions");
            return;
          }
          const session = new TerminalSession(this.spawn, () =>
            this.sessions.delete(session.token),
          );
          this.sessions.set(session.token, session);
          session.attach(socket, 0, false);
        } else if (
          typeof message.session === "string" &&
          /^[a-f0-9]{64}$/.test(message.session)
        ) {
          const session = this.sessions.get(message.session);
          if (!session) socket.close(4404, "Session is no longer available");
          else session.attach(socket, message.bytes, true);
        } else throw new Error();
      } catch {
        socket.close(1002, "Invalid terminal attachment");
      }
    });
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
  }
}
