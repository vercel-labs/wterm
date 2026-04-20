import {
  defineComponent,
  h,
  ref,
  shallowRef,
  onMounted,
  onBeforeUnmount,
  watch,
} from "vue";
import { WTerm } from "@wterm/dom";

const Terminal = defineComponent({
  name: "Terminal",

  // we want to allow passing down classes
  // true is the default
  // inheritAttrs: true,

  props: {
    cols: { type: Number, default: 80 },
    rows: { type: Number, default: 24 },
    wasmUrl: String,
    theme: String,
    autoResize: Boolean,
    cursorBlink: Boolean,
  },

  emits: {
    // Object form: validator signatures carry emit payload types to
    // both internal `emit(...)` and external `@event="..."` handlers.
    data: (_data: string) => true,
    title: (_title: string) => true,
    resize: (_cols: number, _rows: number) => true,
    ready: (_wt: WTerm) => true,
    error: (_err: unknown) => true,
  },

  setup(props, { emit }) {
    const root = ref<HTMLDivElement | null>(null);
    const wterm = shallowRef<WTerm | null>(null);

    onMounted(() => {
      const el = root.value;
      if (!el) return;

      const wt = new WTerm(el, {
        cols: props.cols,
        rows: props.rows,
        wasmUrl: props.wasmUrl,
        autoResize: props.autoResize,
        cursorBlink: props.cursorBlink,
        onData: (data: string) => emit("data", data),
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
      root,
      instance: wterm,
      write(data: string | Uint8Array) {
        wterm.value?.write(data);
      },
      resize(c: number, r: number) {
        wterm.value?.resize(c, r);
      },
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
