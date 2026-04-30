import {
  defineComponent,
  getCurrentInstance,
  h,
  ref,
  shallowRef,
  onMounted,
  onBeforeUnmount,
  watch,
  type PropType,
} from "vue";
import { WTerm, type TerminalCore } from "@wterm/dom";

/**
 * Vue wrapper around {@link WTerm} from `@wterm/dom`. Creates a `WTerm` in
 * `onMounted`, forwards its callbacks as Vue events, and destroys the instance
 * on unmount.
 *
 * `@wterm/vue` re-exports everything from `@wterm/dom`, so a single import
 * covers both the component and the types.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useTemplateRef } from 'vue'
 * import { Terminal, type WTerm } from '@wterm/vue'
 *
 * const term = useTemplateRef('term')
 *
 * function onReady(wt: WTerm) {
 *   wt.write('hello\r\n')
 * }
 *
 * function onData(chunk: string) {
 *   // echo locally; in a real app, forward `chunk` to a PTY/backend
 *   term.value?.write(chunk)
 * }
 * </script>
 *
 * <template>
 *   <Terminal ref="term" :cols="120" :rows="30" @ready="onReady" @data="onData" />
 * </template>
 * ```
 */
const Terminal = defineComponent({
  name: "Terminal",

  // we want to allow passing down classes
  // true is the default
  // inheritAttrs: true,

  props: {
    /**
     * Column count.
     * @defaultValue 80
     */
    cols: { type: Number, default: 80 },
    /**
     * Row count.
     * @defaultValue 24
     */
    rows: { type: Number, default: 24 },
    /**
     * A pre-constructed terminal core. When provided, `wasmUrl` is ignored and
     * this core is used instead of loading the built-in Zig WASM binary.
     */
    core: { type: Object as PropType<TerminalCore>, default: undefined },
    /**
     * Optional override for the WASM binary URL used by the terminal core.
     */
    wasmUrl: String,
    /**
     * Theme name appended as a `theme-<name>` class on the root element.
     */
    theme: String,
    /**
     * When `true`, the terminal observes its container and reflows on size
     * changes. Note: `WTerm` itself defaults `autoResize` to `true`, but Vue
     * Boolean props default to `false` — opt in with `<Terminal auto-resize>`
     * (or `:auto-resize="true"`).
     * @defaultValue false
     */
    autoResize: Boolean,
    /**
     * Toggles the `cursor-blink` class on the root element.
     * @defaultValue false
     */
    cursorBlink: Boolean,
    /**
     * Enable debug mode (init-only — changing after mount has no effect).
     * Exposes a `DebugAdapter` on the underlying `WTerm` instance.
     * @defaultValue false
     */
    debug: Boolean,
  },

  // Object form: validator signatures carry emit payload types to
  // both internal `emit(...)` and external `@event="..."` handlers.
  emits: {
    /**
     * Forwards `WTerm`'s `onData` callback: a chunk of input from the
     * terminal (e.g. keystrokes or paste).
     */
    data: (_data: string) => true,
    /**
     * Forwards `WTerm`'s `onTitle` callback.
     */
    title: (_title: string) => true,
    /**
     * Forwards `WTerm`'s `onResize` callback with the new column and row
     * counts.
     */
    resize: (_cols: number, _rows: number) => true,
    /**
     * Emitted once after `WTerm.init()` resolves, carrying the `WTerm`
     * instance.
     */
    ready: (_wt: WTerm) => true,
    /**
     * Emitted if `WTerm.init()` rejects.
     */
    error: (_err: unknown) => true,
  },

  setup(props, { emit }) {
    const root = ref<HTMLDivElement | null>(null);
    const wterm = shallowRef<WTerm | null>(null);

    onMounted(() => {
      const el = root.value;
      if (!el) return;

      const hasDataListener = !!getCurrentInstance()?.vnode.props?.onData;

      const wt = new WTerm(el, {
        cols: props.cols,
        rows: props.rows,
        core: props.core,
        wasmUrl: props.wasmUrl,
        autoResize: props.autoResize,
        cursorBlink: props.cursorBlink,
        debug: props.debug,
        onData: hasDataListener
          ? (data: string) => emit("data", data)
          : undefined,
        onTitle: (title: string) => emit("title", title),
        onResize: (c: number, r: number) => emit("resize", c, r),
      });

      wterm.value = wt;

      wt.init()
        .then(() => {
          emit("ready", wt);
        })
        .catch((err: unknown) => {
          emit("error", err);
        });
    });

    onBeforeUnmount(() => {
      wterm.value?.destroy();
      wterm.value = null;
    });

    watch(
      () => [props.cols, props.rows] as const,
      ([c, r]) => {
        const wt = wterm.value;
        if (
          wt?.bridge &&
          !props.autoResize &&
          (wt.cols !== c || wt.rows !== r)
        ) {
          wt.resize(c, r);
        }
      },
    );

    watch(
      () => props.cursorBlink,
      (blink) => {
        const wt = wterm.value;
        if (!wt) return;
        wt.element.classList.toggle("cursor-blink", blink);
      },
    );

    // Returning bindings from setup is the typed equivalent of defineExpose:
    // Vue auto-unwraps refs and merges these into InstanceType<typeof Terminal>,
    // so template refs see write/resize/focus/instance with correct types.
    return {
      /**
       * Ref to the host `<div>`. Bound by the string `ref: "root"` used in
       * `render`; consumers normally don't need it.
       */
      root,
      /**
       * Underlying {@link WTerm} instance, reachable through a template ref
       * (`useTemplateRef('…')`). `null` until the component has mounted, then
       * set to the instance; the WASM bridge only becomes available once the
       * `ready` event has fired.
       */
      instance: wterm,
      /**
       * Write bytes/text to the terminal. Safe to call after `ready`; calls
       * before the component has mounted are ignored.
       */
      write(data: string | Uint8Array) {
        wterm.value?.write(data);
      },
      /**
       * Imperatively resize the terminal. Calls before the component has
       * mounted are ignored.
       */
      resize(c: number, r: number) {
        wterm.value?.resize(c, r);
      },
      /**
       * Move keyboard focus to the terminal.
       */
      focus() {
        wterm.value?.focus();
      },
    };
  },
  render() {
    return h("div", {
      ref: "root",
      class: ["wterm", this.theme ? `theme-${this.theme}` : null],
      style: this.autoResize
        ? undefined
        : { height: `${this.rows * 17 + 24}px` },
      role: "textbox",
      "aria-label": "Terminal",
      "aria-multiline": "true",
      "aria-roledescription": "terminal",
    });
  },
});

export default Terminal;
