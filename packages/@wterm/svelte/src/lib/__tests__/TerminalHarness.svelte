<script lang="ts">
  import Terminal from "../Terminal.svelte";

  let cols = $state(80);
  let rows = $state(24);
  let cursorBlink = $state(false);
  let terminal: Terminal;

  export function setSize(nextCols: number, nextRows: number) {
    cols = nextCols;
    rows = nextRows;
  }

  export function setCursorBlink(nextCursorBlink: boolean) {
    cursorBlink = nextCursorBlink;
  }

  export function instance() {
    return terminal.instance();
  }
</script>

<Terminal bind:this={terminal} {cols} {rows} {cursorBlink} />
