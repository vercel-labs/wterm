import type { WebSocketRoute } from "@playwright/test";

const readiness = new WeakMap<WebSocketRoute, Promise<void>>();
export function terminalReady(socket: WebSocketRoute): Promise<void> {
  return readiness.get(socket)!;
}

/** Complete the attachment handshake in deterministic workspace fixtures. */
export function acceptTerminal(socket: WebSocketRoute): void {
  let ready!: () => void;
  readiness.set(
    socket,
    new Promise<void>((resolve) => {
      ready = resolve;
    }),
  );
  const onMessage = socket.onMessage.bind(socket);
  socket.onMessage = (callback) =>
    onMessage((data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "attach") {
        socket.send(
          JSON.stringify({
            type: "ready",
            session: message.session ?? "a".repeat(64),
            resumed: message.session !== null,
          }),
        );
        ready();
      } else callback(data);
    });
  socket.onMessage(() => {});
}
