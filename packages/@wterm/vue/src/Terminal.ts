import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useAttrs,
  watch,
  type PropType,
} from "vue";
import { WTerm } from "@wterm/dom";

export interface TerminalProps {
  cols?: number;
  rows?: number;
  wasmUrl?: string;
  theme?: string;
  autoResize?: boolean;
  cursorBlink?: boolean;
  onData?: (data: string) => void;
  onTitle?: (title: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onReady?: (wt: WTerm) => void;
  onError?: (error: unknown) => void;
}

export interface TerminalHandle {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  focus(): void;
  readonly instance: WTerm | null;
}

function syncLiveOptions(wterm: WTerm, props: Required<Pick<TerminalProps, "cols" | "rows" | "autoResize" | "cursorBlink">> & TerminalProps): void {
  if (!wterm.bridge) {
    return;
  }

  if (!props.autoResize && (wterm.cols !== props.cols || wterm.rows !== props.rows)) {
    wterm.resize(props.cols, props.rows);
  }

  wterm.element.classList.toggle("cursor-blink", props.cursorBlink);
  wterm.onData = props.onData ? (data: string) => props.onData?.(data) : null;
  wterm.onTitle = props.onTitle ? (title: string) => props.onTitle?.(title) : null;
  wterm.onResize = props.onResize
    ? (cols: number, rows: number) => props.onResize?.(cols, rows)
    : null;
}

const Terminal = defineComponent({
  name: "WTermVueTerminal",
  inheritAttrs: false,
  props: {
    cols: { type: Number, default: 80 },
    rows: { type: Number, default: 24 },
    wasmUrl: String,
    theme: String,
    autoResize: { type: Boolean, default: false },
    cursorBlink: { type: Boolean, default: false },
    onData: Function as PropType<(data: string) => void>,
    onTitle: Function as PropType<(title: string) => void>,
    onResize: Function as PropType<(cols: number, rows: number) => void>,
    onReady: Function as PropType<(wt: WTerm) => void>,
    onError: Function as PropType<(error: unknown) => void>,
  },
  setup(props, { expose }) {
    const attrs = useAttrs();
    const elementRef = ref<HTMLDivElement | null>(null);
    const wtermRef = shallowRef<WTerm | null>(null);
    let destroyed = false;
    let mounted = false;
    let terminalVersion = 0;

    const handle: TerminalHandle = {
      write(data: string | Uint8Array) {
        wtermRef.value?.write(data);
      },
      resize(cols: number, rows: number) {
        wtermRef.value?.resize(cols, rows);
      },
      focus() {
        wtermRef.value?.focus();
      },
      get instance() {
        return wtermRef.value;
      },
    };

    expose(handle);

    const applyLiveOptions = () => {
      const wterm = wtermRef.value;
      if (!wterm) {
        return;
      }

      syncLiveOptions(wterm, props);
    };

    const destroyTerminal = () => {
      terminalVersion += 1;
      const wterm = wtermRef.value;
      wtermRef.value = null;
      wterm?.destroy();
    };

    const createTerminal = () => {
      const element = elementRef.value;
      if (!element) {
        return;
      }

      const currentVersion = ++terminalVersion;
      const wterm = new WTerm(element, {
        cols: props.cols,
        rows: props.rows,
        wasmUrl: props.wasmUrl,
        autoResize: props.autoResize,
        cursorBlink: props.cursorBlink,
        onData: props.onData,
        onTitle: props.onTitle,
        onResize: props.onResize,
      });

      wtermRef.value = wterm;

      void wterm
        .init()
        .then(() => {
          if (
            destroyed ||
            currentVersion !== terminalVersion ||
            wtermRef.value !== wterm
          ) {
            wterm.destroy();
            return;
          }

          applyLiveOptions();
          props.onReady?.(wterm);
        })
        .catch((error: unknown) => {
          if (
            destroyed ||
            currentVersion !== terminalVersion ||
            wtermRef.value !== wterm
          ) {
            return;
          }

          destroyTerminal();
          if (props.onError) {
            props.onError(error);
          } else {
            console.error(error);
          }
        });
    };

    watch(
      () => [
        props.cols,
        props.rows,
        props.autoResize,
        props.cursorBlink,
        props.onData,
        props.onTitle,
        props.onResize,
      ],
      () => {
        applyLiveOptions();
      },
      { immediate: true },
    );

    watch(
      () => [props.wasmUrl, props.autoResize] as const,
      ([nextWasmUrl, nextAutoResize], [prevWasmUrl, prevAutoResize]) => {
        if (!mounted) {
          return;
        }

        if (
          nextWasmUrl === prevWasmUrl &&
          nextAutoResize === prevAutoResize
        ) {
          return;
        }

        destroyTerminal();
        createTerminal();
      },
    );

    onMounted(() => {
      mounted = true;
      createTerminal();
    });

    onBeforeUnmount(() => {
      destroyed = true;
      destroyTerminal();
    });

    return () => {
      const { class: className, style, ...restAttrs } = attrs as Record<string, unknown>;

      return h("div", {
        ...restAttrs,
        ref: elementRef,
        class: ["wterm", props.theme ? `theme-${props.theme}` : null, className],
        style: props.autoResize
          ? style
          : [{ height: `${props.rows * 17 + 24}px` }, style],
        role: "textbox",
        "aria-label": "Terminal",
        "aria-multiline": "true",
        "aria-roledescription": "terminal",
      });
    };
  },
});

export default Terminal;
