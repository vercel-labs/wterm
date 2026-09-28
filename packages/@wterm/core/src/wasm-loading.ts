import { WASM_BASE64 } from "./wasm-inline.js";

let embedded: Promise<WebAssembly.Module> | undefined;
const modules = new Map<string, Promise<WebAssembly.Module>>();
const MAX_CACHED_MODULES = 4;

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function compileUrl(url: string): Promise<WebAssembly.Module> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[wterm] Failed to load WASM from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  if (
    typeof WebAssembly.compileStreaming === "function" &&
    response.headers.get("Content-Type")?.trim().toLowerCase() ===
      "application/wasm"
  ) {
    try {
      return await WebAssembly.compileStreaming(response.clone());
    } catch {
      // Retain the original response for buffered fallback without refetching.
    }
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

/** Share compiled code, including pending work; callers create fresh instances. */
export function loadWasmModule(url?: string): Promise<WebAssembly.Module> {
  if (!url) {
    embedded ??= Promise.resolve()
      .then(() => WebAssembly.compile(decodeBase64(WASM_BASE64)))
      .catch((error: unknown) => {
        embedded = undefined;
        throw error;
      });
    return embedded;
  }

  if (typeof document !== "undefined")
    url = new URL(url, document.baseURI).href;
  else if (typeof location !== "undefined")
    url = new URL(url, location.href).href;
  const key = url;
  const cached = modules.get(key);
  if (cached) {
    modules.delete(key);
    modules.set(key, cached);
    return cached;
  }
  const pending = compileUrl(key).catch((error: unknown) => {
    if (modules.get(key) === pending) modules.delete(key);
    throw error;
  });
  modules.set(key, pending);
  if (modules.size > MAX_CACHED_MODULES)
    modules.delete(modules.keys().next().value!);
  return pending;
}
