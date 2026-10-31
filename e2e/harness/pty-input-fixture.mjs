import { inputFixture, INPUT_WORKLOADS } from "./src/input-workloads.ts";

const workload = process.argv[2];
if (
  !INPUT_WORKLOADS.includes(workload) ||
  !process.stdin.isTTY ||
  !process.stdout.isTTY
)
  throw new Error("Expected a supported workload and a real PTY");
process.stdin.setRawMode(true);
process.stdin.resume();
const chunks = inputFixture(workload).map((chunk) => Buffer.from(chunk));
let started = false;
let stopped = false;
let writes = 0;
let bytes = 0;
let probes = 0;
let timer;
const deadline = setTimeout(() => process.exit(2), 90_000);
const echo = (text) => `\x1b7\x1b[1;1H\x1b[0m\x1b[2K${text}\x1b8`;
process.stdout.write("\x1b[?25l\x1b[2;24r\x1b[2;1H" + echo("pty ready"));

function produce() {
  if (stopped || !chunks.length) return;
  const chunk = chunks[writes % chunks.length];
  writes++;
  bytes += chunk.length;
  // One complete chunk per 16 ms, with no catch-up bursts. Wait for the
  // stream before scheduling again, so a blocked PTY cannot grow this queue.
  process.stdout.write(chunk, () => {
    if (!stopped) timer = setTimeout(produce, 16);
  });
}

process.stdin.on("data", (data) => {
  for (const key of data.toString("ascii")) {
    if (key === "\x01" && !started) {
      started = true;
      produce();
    } else if (key === "\x02" && started && !stopped) {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      const summary = `done writes=${writes} bytes=${bytes} probes=${probes}`;
      process.stdout.write(`\x1b7\x1b[2;1H\x1b[0m\x1b[2K${summary}\x1b8`, () =>
        process.exit(0),
      );
    } else if (started && !stopped && /^[a-z]$/.test(key) && probes < 1024) {
      probes++;
      process.stdout.write(
        echo(`echo ${String(probes).padStart(4, "0")}: ${key}`),
      );
    } else {
      process.exit(3);
    }
  }
});
