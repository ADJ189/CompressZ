<script lang="ts">
  import SettingsDialog from "../app/SettingsDialog.svelte";
  import { navigate } from "../router";

  let isOpen = $state(true);

  function handleClose() {
    isOpen = false;
    navigate("");
  }
</script>

<div class="cz-settings-page-wrapper">
  <SettingsDialog open={isOpen} onClose={handleClose} />
</div>

<style>
  .cz-settings-page-wrapper {
    min-height: 70vh;
  }
</style>
