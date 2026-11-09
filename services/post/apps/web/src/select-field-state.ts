export type SelectOption = { value: string; label: string; disabled?: boolean };

export function selectKeyIntent(key: string, open: boolean) {
  if (key === "Escape" || key === "Tab") return open ? "cancel" : null;
  if (key === "Enter" || key === " ") return open ? "commit" : "open";
  return null;
}

export function selectStep(options: readonly SelectOption[], current: number, offset: number) {
  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));
  if (!enabled.length) return -1;
  const position = enabled.indexOf(current);
  const next = Math.max(0, Math.min(enabled.length - 1, (position < 0 ? 0 : position) + offset));
  return enabled[next];
}

export function selectEdge(options: readonly SelectOption[], edge: "first" | "last") {
  const enabled = options.flatMap((option, index) => (option.disabled ? [] : [index]));
  return (edge === "first" ? enabled[0] : enabled.at(-1)) ?? -1;
}

export function selectTypeahead(
  options: readonly SelectOption[],
  current: number,
  previous: { text: string; at: number },
  key: string,
  now: number,
) {
  const letter = key.toLocaleLowerCase();
  const text = (now - previous.at <= 700 ? previous.text : "") + letter;
  const repeated = Array.from(text).every((character) => character === letter);
  const query = repeated ? letter : text;
  const start = repeated ? current + 1 : Math.max(0, current);
  for (let offset = 0; offset < options.length; offset++) {
    const index = (start + offset + options.length) % options.length;
    if (!options[index].disabled && options[index].label.toLocaleLowerCase().startsWith(query))
      return { index, text, at: now };
  }
  return { index: current, text, at: now };
}

export function selectPlacement(
  anchor: { left: number; top: number; bottom: number; width: number },
  viewport: { width: number; height: number },
  count: number,
) {
  const width = Math.max(0, Math.min(anchor.width, viewport.width - 16));
  const left = Math.max(8, Math.min(anchor.left, viewport.width - width - 8));
  const desired = Math.min(210, count * 40 + 10);
  const below = Math.max(0, viewport.height - anchor.bottom - 12);
  const above = Math.max(0, anchor.top - 12);
  const side = below >= desired || below >= above ? "bottom" : "top";
  const height = Math.min(desired, side === "bottom" ? below : above);
  return {
    left,
    width,
    height,
    top: side === "bottom" ? anchor.bottom + 4 : anchor.top - 4 - height,
    side,
  };
}
