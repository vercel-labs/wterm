import { GhosttyCore } from "@wterm/ghostty";

declare global {
  interface Window {
    ghosttyLoading: typeof GhosttyCore;
  }
}

window.ghosttyLoading = GhosttyCore;
