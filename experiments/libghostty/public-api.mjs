// Experimental bindings to the upstream public C ABI. Layouts and enums come
// from ghostty_type_json(), not private Zig structs or hard-coded offsets.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const primitives = {
  bool: [1, "getUint8", "setUint8"],
  u8: [1, "getUint8", "setUint8"],
  u16: [2, "getUint16", "setUint16"],
  u32: [4, "getUint32", "setUint32"],
  i32: [4, "getInt32", "setInt32"],
  u64: [8, "getBigUint64", "setBigUint64"],
  pointer: [4, "getUint32", "setUint32"],
};

// A tiny Wasm function forwards i32 arguments to a JS import. Exported Wasm
// functions can enter a funcref table in Node and browsers without relying on
// the nonstandard WebAssembly.Function constructor. All registered effects
// here return void and use wasm32 integer/pointer arguments.
function callbackFunction(arity, fn) {
  const section = (id, bytes) => [id, bytes.length, ...bytes];
  const body = [
    0,
    ...Array.from({ length: arity }, (_, i) => [0x20, i]).flat(),
    0x10,
    0,
    0x0b,
  ];
  const bytes = new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(1, [1, 0x60, arity, ...Array(arity).fill(0x7f), 0]),
    ...section(2, [1, 1, 101, 1, 102, 0, 0]), // import e.f, function type 0
    ...section(3, [1, 0]),
    ...section(7, [1, 1, 102, 0, 1]), // export defined function f
    ...section(10, [1, body.length, ...body]),
  ]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    e: { f: fn },
  }).exports.f;
}

export class PublicApi {
  static async load(bytes) {
    const start = performance.now();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const api = new PublicApi(instance.exports);
    api.instantiateMs = performance.now() - start;
    return api;
  }

  constructor(exports) {
    this.exports = exports;
    const start = exports.ghostty_type_json();
    const bytes = new Uint8Array(exports.memory.buffer);
    this.layout = JSON.parse(
      decoder.decode(bytes.subarray(start, bytes.indexOf(0, start))),
    );
    const { pointer_size, usize_size, endian } = this.layout.abi;
    if (pointer_size !== 4 || usize_size !== 4 || endian !== "little")
      throw new Error("Expected the pinned wasm32 ABI");
    this.freeCallbackSlots = [];
  }

  enum(type, key) {
    const value = this.layout.types[type]?.values?.[key];
    if (value === undefined)
      throw new Error(`Missing public enum ${type}.${key}`);
    return value;
  }

  check(result, name) {
    if (result === this.enum("GhosttyResult", "SUCCESS")) return;
    const error = new Error(`${name}: libghostty result ${result}`);
    error.code = result;
    throw error;
  }

  size(type) {
    return primitives[type]?.[0] ?? this.layout.types[type].size;
  }

  withMemory(size, fn) {
    const ptr = this.exports.ghostty_wasm_alloc(size);
    if (!ptr) throw new Error("Wasm allocation failed");
    try {
      new Uint8Array(this.exports.memory.buffer, ptr, size).fill(0);
      return fn(ptr);
    } finally {
      this.exports.ghostty_wasm_free(ptr, size);
    }
  }

  withValue(type, value, fn) {
    return this.withMemory(this.size(type), (ptr) => {
      this.write(type, ptr, value);
      return fn(ptr);
    });
  }

  read(type, ptr) {
    const primitive = primitives[type];
    // Never retain views across a call that could grow Wasm memory.
    if (primitive) {
      const value = new DataView(this.exports.memory.buffer)[primitive[1]](
        ptr,
        true,
      );
      return type === "bool" ? !!value : value;
    }
    const info = this.layout.types[type];
    if (info.underlying) return this.read(info.underlying, ptr);
    if (info.kind === "alias") return this.read(info.type, ptr);
    return Object.fromEntries(
      Object.entries(info.fields)
        .filter(([name]) => !name.startsWith("_"))
        .map(([name, field]) => [
          name,
          field.type === "array"
            ? Array.from({ length: field.count }, (_, i) =>
                this.read(
                  field.elem,
                  ptr + field.offset + i * this.size(field.elem),
                ),
              )
            : this.read(field.type, ptr + field.offset),
        ]),
    );
  }

  write(type, ptr, value) {
    const primitive = primitives[type];
    if (primitive) {
      new DataView(this.exports.memory.buffer)[primitive[2]](
        ptr,
        type === "bool" ? Number(value) : value,
        true,
      );
      return;
    }
    const info = this.layout.types[type];
    if (info.underlying) return this.write(info.underlying, ptr, value);
    if (info.kind === "alias") return this.write(info.type, ptr, value);
    const fields = { ...value };
    if (info.fields.size) fields.size = info.size;
    for (const [name, data] of Object.entries(fields)) {
      const field = info.fields[name];
      if (!field) throw new Error(`Missing public field ${type}.${name}`);
      this.write(field.type, ptr + field.offset, data);
    }
  }

  handle(name, ...args) {
    return this.withMemory(4, (out) => {
      this.check(this.exports[name](0, out, ...args), name);
      return this.read("pointer", out);
    });
  }

  query(name, handle, enumType, key, type, initial = {}) {
    return this.withMemory(this.size(type), (out) => {
      if (this.layout.types[type]?.fields) this.write(type, out, initial);
      this.check(
        this.exports[name](handle, this.enum(enumType, key), out),
        `${name}(${key})`,
      );
      return this.read(type, out);
    });
  }

  string(value) {
    return decoder.decode(
      new Uint8Array(this.exports.memory.buffer, value.ptr, value.len),
    );
  }

  terminal(cols = 80, rows = 24) {
    return new PublicTerminal(
      this,
      this.handle("ghostty_terminal_new", cols, rows),
    );
  }

  restore(bytes) {
    return this.withMemory(bytes.length, (ptr) => {
      new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
      const handle = this.handle(
        "ghostty_snapshot_decoder_new_buf",
        ptr,
        bytes.length,
      );
      try {
        for (const [key, type, value] of [
          ["MAX_CONTINUATION_BYTES", "u32", 1024 * 1024],
          ["RETAIN_CONTINUATION", "bool", true],
        ]) {
          this.withValue(type, value, (out) =>
            this.check(
              this.exports.ghostty_snapshot_decoder_set(
                handle,
                this.enum("GhosttySnapshotDecoderOption", key),
                out,
              ),
              key,
            ),
          );
        }
        return this.withMemory(4, (out) => {
          this.check(
            this.exports.ghostty_snapshot_decoder_decode(handle, out),
            "snapshot decode",
          );
          return new PublicTerminal(this, this.read("pointer", out));
        });
      } finally {
        this.exports.ghostty_snapshot_decoder_free(handle);
      }
    });
  }
}

export class PublicTerminal {
  constructor(api, terminal) {
    this.api = api;
    this.terminal = terminal;
    this.effects = [];
    this.callbackSlots = [];
    this.owned = [["ghostty_terminal_free", terminal]];
    try {
      for (const [field, stem] of [
        ["renderState", "ghostty_render_state"],
        ["rows", "ghostty_render_state_row_iterator"],
        ["cells", "ghostty_render_state_row_cells"],
      ]) {
        this[field] = api.handle(`${stem}_new`);
        this.owned.push([`${stem}_free`, this[field]]);
      }
      this.on("WRITE_PTY", 4, (_term, _user, ptr, len) =>
        this.effects.push({ type: "reply", data: api.string({ ptr, len }) }),
      );
      this.on("BELL", 2, () => this.effects.push({ type: "bell" }));
      this.on("TITLE_CHANGED", 2, () => this.effects.push({ type: "title" }));
      this.on("PWD_CHANGED", 2, () => this.effects.push({ type: "pwd" }));
      this.set("CONTINUATION_MAX_BYTES", "u32", 1024 * 1024);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  on(option, arity, fn) {
    const table = this.api.exports.__indirect_function_table;
    const slot = this.api.freeCallbackSlots.pop() ?? table.grow(1);
    table.set(slot, callbackFunction(arity, fn));
    this.callbackSlots.push(slot);
    // Callback options accept the function pointer directly (not its address).
    this.api.check(
      this.api.exports.ghostty_terminal_set(
        this.terminal,
        this.api.enum("GhosttyTerminalOption", option),
        slot,
      ),
      option,
    );
  }

  set(option, type, value) {
    this.api.withValue(type, value, (ptr) =>
      this.api.check(
        this.api.exports.ghostty_terminal_set(
          this.terminal,
          this.api.enum("GhosttyTerminalOption", option),
          ptr,
        ),
        option,
      ),
    );
  }

  get(key, type) {
    return this.api.query(
      "ghostty_terminal_get",
      this.terminal,
      "GhosttyTerminalData",
      key,
      type,
    );
  }

  mode(number) {
    // modes.h defines DEC private modes as the low 15 bits, with bit 15 clear.
    return this.api.query(
      "ghostty_terminal_get",
      this.terminal,
      "GhosttyTerminalData",
      "MODE",
      "GhosttyTerminalModeConfig",
      { mode: number },
    ).value;
  }

  track(x, y) {
    const api = this.api;
    return api.withValue(
      "GhosttyPoint",
      {
        tag: api.enum("GhosttyPointTag", "ACTIVE"),
        value: { coordinate: { x, y } },
      },
      (point) =>
        api.withMemory(4, (out) => {
          api.check(
            api.exports.ghostty_terminal_grid_ref_track(
              this.terminal,
              point,
              out,
            ),
            "track",
          );
          const handle = api.read("pointer", out);
          this.owned.push(["ghostty_tracked_grid_ref_free", handle]);
          return {
            point: (tag) =>
              api.query(
                "ghostty_tracked_grid_ref_point",
                handle,
                "GhosttyPointTag",
                tag,
                "GhosttyPointCoordinate",
              ),
            valid: () =>
              !!api.exports.ghostty_tracked_grid_ref_has_value(handle),
          };
        }),
    );
  }

  search(needle) {
    const api = this.api;
    const handle = api.handle("ghostty_search_new", this.terminal);
    const bytes = encoder.encode(needle);
    try {
      api.withMemory(bytes.length, (ptr) => {
        new Uint8Array(api.exports.memory.buffer, ptr, bytes.length).set(bytes);
        api.withValue("GhosttyString", { ptr, len: bytes.length }, (value) =>
          api.check(
            api.exports.ghostty_search_set(
              handle,
              api.enum("GhosttySearchOption", "NEEDLE"),
              value,
            ),
            "search needle",
          ),
        );
      });
      api.check(api.exports.ghostty_search_run(handle), "search run");
      return {
        status: api.query(
          "ghostty_search_get",
          handle,
          "GhosttySearchData",
          "STATUS",
          "GhosttySearchStatus",
        ),
        count: api.query(
          "ghostty_search_get",
          handle,
          "GhosttySearchData",
          "TOTAL_MATCHES",
          "u32",
        ),
      };
    } finally {
      api.exports.ghostty_search_free(handle);
    }
  }

  gridText(tag, x, y) {
    const api = this.api;
    return api.withValue(
      "GhosttyPoint",
      {
        tag: api.enum("GhosttyPointTag", tag),
        value: { coordinate: { x, y } },
      },
      (point) =>
        api.withValue("GhosttyGridRef", {}, (ref) => {
          api.check(
            api.exports.ghostty_terminal_grid_ref(this.terminal, point, ref),
            "grid reference",
          );
          return api.withMemory(4, (lenOut) => {
            const result = api.exports.ghostty_grid_ref_graphemes(
              ref,
              0,
              0,
              lenOut,
            );
            if (result !== api.enum("GhosttyResult", "OUT_OF_SPACE"))
              api.check(result, "grapheme size");
            const len = api.read("u32", lenOut);
            if (!len) return "";
            return api.withMemory(len * 4, (buf) => {
              api.check(
                api.exports.ghostty_grid_ref_graphemes(ref, buf, len, lenOut),
                "grid graphemes",
              );
              return String.fromCodePoint(
                ...new Uint32Array(api.exports.memory.buffer, buf, len),
              );
            });
          });
        }),
    );
  }

  write(input) {
    const bytes = typeof input === "string" ? encoder.encode(input) : input;
    if (!bytes.length) return;
    this.api.withMemory(bytes.length, (ptr) => {
      new Uint8Array(this.api.exports.memory.buffer, ptr, bytes.length).set(
        bytes,
      );
      this.api.exports.ghostty_terminal_vt_write(
        this.terminal,
        ptr,
        bytes.length,
      );
    });
  }

  resize(cols, rows) {
    this.api.check(
      this.api.exports.ghostty_terminal_resize(
        this.terminal,
        cols,
        rows,
        8,
        16,
      ),
      "resize",
    );
  }

  snapshot() {
    const api = this.api;
    return api.withMemory(8, (out) => {
      api.check(
        api.exports.ghostty_snapshot_encode_alloc(
          this.terminal,
          0,
          out,
          out + 4,
        ),
        "snapshot encode",
      );
      const ptr = api.read("pointer", out);
      const len = api.read("u32", out + 4);
      try {
        return new Uint8Array(api.exports.memory.buffer, ptr, len).slice();
      } finally {
        api.exports.ghostty_free(0, ptr, len);
      }
    });
  }

  render() {
    const api = this.api;
    const e = api.exports;
    api.check(
      e.ghostty_render_state_update(this.renderState, this.terminal),
      "render update",
    );
    const cursor = api.query(
      "ghostty_render_state_get",
      this.renderState,
      "GhosttyRenderStateData",
      "CURSOR",
      "GhosttyRenderStateCursor",
    );
    const dirty = api.query(
      "ghostty_render_state_get",
      this.renderState,
      "GhosttyRenderStateData",
      "DIRTY",
      "i32",
    );
    const grid = [];
    api.withValue("pointer", this.rows, (out) =>
      api.check(
        e.ghostty_render_state_get(
          this.renderState,
          api.enum("GhosttyRenderStateData", "ROW_ITERATOR"),
          out,
        ),
        "rows",
      ),
    );
    while (e.ghostty_render_state_row_iterator_next(this.rows)) {
      const row = [];
      api.withValue("pointer", this.cells, (out) =>
        api.check(
          e.ghostty_render_state_row_get(
            this.rows,
            api.enum("GhosttyRenderStateRowData", "CELLS"),
            out,
          ),
          "cells",
        ),
      );
      const rowDirty = api.query(
        "ghostty_render_state_row_get",
        this.rows,
        "GhosttyRenderStateRowData",
        "DIRTY",
        "bool",
      );
      while (e.ghostty_render_state_row_cells_next(this.cells)) {
        const raw = api.query(
          "ghostty_render_state_row_cells_get",
          this.cells,
          "GhosttyRenderStateRowCellsData",
          "RAW",
          "u64",
        );
        const wide = api.query(
          "ghostty_cell_get",
          raw,
          "GhosttyCellData",
          "WIDE",
          "GhosttyCellWide",
        );
        const style = api.query(
          "ghostty_render_state_row_cells_get",
          this.cells,
          "GhosttyRenderStateRowCellsData",
          "STYLE",
          "GhosttyStyle",
        );
        const len = api.query(
          "ghostty_render_state_row_cells_get",
          this.cells,
          "GhosttyRenderStateRowCellsData",
          "GRAPHEMES_LEN",
          "u32",
        );
        const text = len
          ? api.withMemory(len * 4, (ptr) => {
              api.check(
                e.ghostty_render_state_row_cells_get(
                  this.cells,
                  api.enum("GhosttyRenderStateRowCellsData", "GRAPHEMES_BUF"),
                  ptr,
                ),
                "graphemes",
              );
              return String.fromCodePoint(
                ...new Uint32Array(e.memory.buffer, ptr, len),
              );
            })
          : "";
        const width =
          wide === api.enum("GhosttyCellWide", "WIDE")
            ? 2
            : wide === api.enum("GhosttyCellWide", "SPACER_TAIL")
              ? 0
              : 1;
        row.push({ text, width, style });
      }
      grid.push({
        dirty: rowDirty,
        cells: row,
        text: row
          .map((cell) => (cell.width ? cell.text || " " : ""))
          .join("")
          .trimEnd(),
      });
    }
    return {
      cols: this.get("COLS", "u16"),
      rows: this.get("ROWS", "u16"),
      cursor,
      dirty,
      grid,
    };
  }

  clean() {
    this.api.check(
      this.api.exports.ghostty_render_state_clean(this.renderState),
      "render clean",
    );
  }

  dispose() {
    for (const [name, handle] of this.owned.splice(0).reverse())
      this.api.exports[name](handle);
    for (const slot of this.callbackSlots.splice(0)) {
      this.api.exports.__indirect_function_table.set(slot, null);
      this.api.freeCallbackSlots.push(slot);
    }
  }
}
