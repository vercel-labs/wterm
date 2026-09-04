<script lang="ts">
  import Terminal from "../lib/Terminal.svelte";

  export let ondata: (event: CustomEvent<string>) => void;
</script>

<Terminal on:data={ondata} />
