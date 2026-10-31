import type { Page } from "@playwright/test";

export function collectBrowserErrors(page: Page) {
  const report = { resizeObserverNotifications: 0, errors: [] as string[] };
  page.on("pageerror", (error) => {
    // The browser emits this diagnostic when it defers resize notifications
    // to a later frame. Retain it separately from application exceptions.
    if (
      error.message ===
      "ResizeObserver loop completed with undelivered notifications."
    ) {
      report.resizeObserverNotifications++;
    } else if (report.errors.length < 16) {
      report.errors.push(error.message);
    }
  });
  return report;
}
