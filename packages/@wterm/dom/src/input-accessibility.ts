const LABEL_ATTRIBUTES = [
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-description",
] as const;

/** Keep host-provided names and tab order on the element receiving input. */
export class InputAccessibility {
  private observer: MutationObserver;
  private tabIndex: string | null;
  private defaultRole: boolean;
  private destroyed = false;

  constructor(
    private host: HTMLElement,
    private input: HTMLTextAreaElement,
  ) {
    this.tabIndex = host.getAttribute("tabindex");
    this.defaultRole = !host.hasAttribute("role");
    if (this.defaultRole) host.setAttribute("role", "group");
    this.observer = new MutationObserver((records) => this.sync(records));
    this.sync();
  }

  private sync(records: MutationRecord[] = []): void {
    if (records.some((record) => record.attributeName === "tabindex"))
      this.tabIndex = this.host.getAttribute("tabindex");
    for (const attribute of LABEL_ATTRIBUTES) {
      const value = this.host.getAttribute(attribute);
      if (value?.trim()) this.input.setAttribute(attribute, value);
      else this.input.removeAttribute(attribute);
    }
    if (!this.input.hasAttribute("aria-label"))
      this.input.setAttribute("aria-label", "Terminal");
    this.input.setAttribute("tabindex", this.tabIndex ?? "0");

    // The host and textarea must not become two sequential tab stops. Do not
    // observe our own normalization as a new host request; framework updates
    // (including a repeated -1) still reach the observer.
    this.observer.disconnect();
    if (this.tabIndex !== null) this.host.setAttribute("tabindex", "-1");
    this.observer.observe(this.host, {
      attributes: true,
      attributeFilter: [...LABEL_ATTRIBUTES, "tabindex"],
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const pending = this.observer.takeRecords();
    if (pending.some((record) => record.attributeName === "tabindex"))
      this.tabIndex = this.host.getAttribute("tabindex");
    this.observer.disconnect();
    if (this.tabIndex === null) this.host.removeAttribute("tabindex");
    else this.host.setAttribute("tabindex", this.tabIndex);
    if (this.defaultRole && this.host.getAttribute("role") === "group")
      this.host.removeAttribute("role");
  }
}
