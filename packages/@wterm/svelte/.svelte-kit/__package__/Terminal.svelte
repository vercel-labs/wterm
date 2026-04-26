<script lang="ts">import { onMount } from "svelte";
import { WTerm } from "@wterm/dom";
let { cols = 80, rows = 24, wasmUrl, theme, autoResize = false, cursorBlink = false, debug = false, onData, onTitle, onResize, onReady, onError, class: className = "", style, ...rest } = $props();
let root;
let current = $state(null);
export function write(data) {
	current?.write(data);
}
export function resize(nextCols, nextRows) {
	current?.resize(nextCols, nextRows);
}
export function focus() {
	current?.focus();
}
export function instance() {
	return current;
}
const classes = $derived([
	"wterm",
	theme ? `theme-${theme}` : null,
	className
].filter(Boolean).join(" "));
const mergedStyle = $derived.by(() => {
	if (autoResize) return style;
	const fixedHeight = `height: ${rows * 17 + 24}px`;
	return style ? `${fixedHeight}; ${style}` : fixedHeight;
});
onMount(() => {
	const wt = new WTerm(root, {
		cols,
		rows,
		wasmUrl,
		autoResize,
		cursorBlink,
		debug,
		onData: onData ? (data) => onData?.(data) : undefined,
		onTitle: (title) => onTitle?.(title),
		onResize: (nextCols, nextRows) => onResize?.(nextCols, nextRows)
	});
	current = wt;
	wt.init().then(() => {
		onReady?.(wt);
	}).catch((err) => {
		if (onError) {
			onError(err);
		} else {
			console.error(err);
		}
	});
	return () => {
		wt.destroy();
		if (current === wt) current = null;
	};
});
$effect(() => {
	const wt = current;
	if (wt?.bridge && !autoResize && (wt.cols !== cols || wt.rows !== rows)) {
		wt.resize(cols, rows);
	}
});
$effect(() => {
	current?.element.classList.toggle("cursor-blink", cursorBlink);
});
</script>

<div
  {...rest}
  bind:this={root}
  class={classes || undefined}
  style={mergedStyle}
  role="textbox"
  aria-label="Terminal"
  aria-multiline="true"
  aria-roledescription="terminal"
></div>
