import { readFileSync, writeFileSync } from "fs";
import { deflateSync, constants } from "zlib";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const wasmPath = join(__dirname, "..", "wasm", "wterm.wasm");
const outPath = join(__dirname, "..", "src", "wasm-inline.ts");

const wasm = readFileSync(wasmPath);
// Deflated first, the base64 is much smaller, and a bundle's
// gzip cannot recover that from base64 of the raw bytes. The loader inflates
// it with DecompressionStream.
const base64 = deflateSync(wasm, {
  level: constants.Z_BEST_COMPRESSION,
}).toString("base64");

writeFileSync(
  outPath,
  `// Auto-generated — do not edit. Run \`node scripts/inline-wasm.js\` to regenerate.\nexport const WASM_DEFLATE_BASE64 = "${base64}";\n`,
);
