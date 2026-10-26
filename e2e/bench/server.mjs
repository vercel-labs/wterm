// Starts `vite preview` on a free port and returns its base URL once it serves the bench page.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

export async function startPreview() {
  const port = await freePort();
  const proc = spawn(
    "npx",
    ["vite", "preview", "--port", String(port), "--strictPort"],
    {
      cwd: import.meta.dirname,
      stdio: "ignore",
    },
  );
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(base);
      if (res.ok && (await res.text()).includes("<title>wterm bench</title>"))
        break;
    } catch {}
    if (i > 100) throw new Error("preview server did not start");
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, stop: () => proc.kill() };
}
