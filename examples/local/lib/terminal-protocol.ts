// Limits are shared by the browser and the local PTY server.
export const OUTPUT_WINDOW = 128 * 1024;
export const OUTPUT_LOW_WATER = 32 * 1024;
export const OUTPUT_FRAMES = 256;
export const OUTPUT_CHUNK = 16 * 1024;
export const OUTPUT_PENDING_LIMIT = 256 * 1024;
export const OUTPUT_PENDING_FRAMES = 1024;
export const INPUT_LIMIT = 64 * 1024;
export const CONTROL_RESERVE = 4096;
export const SESSION_GRACE_MS = 30_000;
export const RECONNECT_MS = 25_000;
export const HANDSHAKE_MS = 5_000;
export const SESSION_LIMIT = 32;

export type ClientMessage =
  | { type: "attach"; session: string | null; bytes: number }
  | { type: "close" }
  | { type: "input"; data: string }
  | { type: "ack"; bytes: number }
  | {
      type: "resize";
      cols: number;
      rows: number;
      width: number;
      height: number;
    };

export function isResize(
  message: Partial<ClientMessage> & Record<string, unknown>,
): message is Extract<ClientMessage, { type: "resize" }> {
  return (
    message.type === "resize" &&
    Number.isInteger(message.cols) &&
    Number(message.cols) >= 1 &&
    Number(message.cols) <= 1024 &&
    Number.isInteger(message.rows) &&
    Number(message.rows) >= 1 &&
    Number(message.rows) <= 512 &&
    Number.isInteger(message.width) &&
    Number(message.width) >= 1 &&
    Number(message.width) <= 65535 &&
    Number.isInteger(message.height) &&
    Number(message.height) >= 1 &&
    Number(message.height) <= 65535
  );
}
