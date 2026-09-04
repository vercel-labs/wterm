<script lang="ts">
  import Terminal from "../lib/Terminal.svelte";

  export let ondata: (event: CustomEvent<string>) => void;
  export let rows = 24;
</script>

<Terminal {rows} on:data={ondata} />
