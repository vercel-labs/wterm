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

export interface TerminalProps {
  cols?: number;
  rows?: number;
  wasmUrl?: string;
  theme?: string;
  autoResize?: boolean;
  cursorBlink?: boolean;
}

export interface TerminalEmits {
  (e: "data", data: string): void;
  (e: "title", title: string): void;
  (e: "resize", cols: number, rows: number): void;
  (e: "ready", wt: WTerm): void;
  (e: "error", err: unknown): void;
}

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  readonly instance: WTerm | null;
}

const Terminal = defineComponent({
  name: "Terminal",
  props: {
    cols: { type: Number, default: 80 },
    rows: { type: Number, default: 24 },
    wasmUrl: { type: String, default: undefined },
    theme: { type: String, default: undefined },
    autoResize: { type: Boolean, default: false },
    cursorBlink: { type: Boolean, default: false },
  },
  emits: ["data", "title", "resize", "ready", "error"],
  setup(props, { emit, expose }) {
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
        if (wt?.bridge && !props.autoResize && (wt.cols !== c || wt.rows !== r)) {
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

    expose({
      write(data: string | Uint8Array) {
        wterm.value?.write(data);
      },
      resize(c: number, r: number) {
        wterm.value?.resize(c, r);
      },
      focus() {
        wterm.value?.focus();
      },
      get instance() {
        return wterm.value;
      },
    } satisfies TerminalHandle);

    return () =>
      h("div", {
        ref: root,
        class: ["wterm", props.theme ? `theme-${props.theme}` : null],
        style: props.autoResize
          ? undefined
          : { height: `${props.rows * 17 + 24}px` },
        role: "textbox",
        "aria-label": "Terminal",
        "aria-multiline": "true",
        "aria-roledescription": "terminal",
      });
  },
});

export default Terminal;
