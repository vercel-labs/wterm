type ModifierEvent = Pick<KeyboardEvent, "ctrlKey" | "metaKey">;

export function isLinkActivationModifier(
  event: ModifierEvent,
  navigator: Navigator,
): boolean {
  return navigator.platform.startsWith("Mac") ? event.metaKey : event.ctrlKey;
}
