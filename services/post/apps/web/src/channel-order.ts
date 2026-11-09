import type { GuildCategory, GuildChannel } from "../../../packages/contracts/generated/ts/models";

export type OrderItem = { kind: "channel" | "category"; id: string };
export type OrderTarget = OrderItem & { edge: "before" | "after" | "inside" };
export type ChannelOrder = {
  categories: { id: string; position: number }[];
  channels: { id: string; position: number; category_id?: string }[];
};
type Positioned = { id: string; position: number };
export const sortResources = <T extends Positioned>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

function positionChanges<T extends Positioned>(items: T[], movedID: string) {
  if (items.length === 1) return [{ id: movedID, position: 0 }];
  const index = items.findIndex((item) => item.id === movedID);
  const previous = items[index - 1]?.position ?? -1;
  const next = items[index + 1]?.position ?? 10001;
  if (next - previous > 1) {
    const position =
      index === items.length - 1
        ? Math.min(10000, previous + 100)
        : Math.floor((previous + next) / 2);
    return [{ id: movedID, position }];
  }
  return items
    .map((item, i) => ({ id: item.id, position: i * 100 }))
    .filter((item, i) => item.position !== items[i].position);
}

export function planResourceMove(
  categories: readonly GuildCategory[],
  channels: readonly GuildChannel[],
  item: OrderItem,
  target: OrderTarget,
): ChannelOrder | null {
  if (item.kind === target.kind && item.id === target.id) return null;
  if (item.kind === "category") {
    if (target.kind !== "category" || !target.id || target.edge === "inside") return null;
    const original = sortResources(categories);
    const moved = original.find((row) => row.id === item.id);
    if (!moved || !original.some((row) => row.id === target.id)) return null;
    const next = original.filter((row) => row.id !== item.id);
    const index = next.findIndex((row) => row.id === target.id) + (target.edge === "after" ? 1 : 0);
    next.splice(index, 0, moved);
    if (next.every((row, i) => row.id === original[i].id)) return null;
    return { categories: positionChanges(next, item.id), channels: [] };
  }
  const moved = channels.find((row) => row.id === item.id);
  if (!moved) return null;
  const neighbor = target.kind === "channel" ? channels.find((row) => row.id === target.id) : null;
  if (target.kind === "channel" && (!neighbor || target.edge === "inside")) return null;
  if (target.kind === "category" && target.edge !== "inside") return null;
  const category = neighbor?.category_id ?? (target.kind === "category" ? target.id : "");
  if (category && !categories.some((row) => row.id === category)) return null;
  const original = sortResources(channels.filter((row) => (row.category_id ?? "") === category));
  const next = original.filter((row) => row.id !== item.id);
  const index = neighbor
    ? next.findIndex((row) => row.id === neighbor.id) + (target.edge === "after" ? 1 : 0)
    : next.length;
  next.splice(index, 0, moved);
  const changedParent = (moved.category_id ?? "") !== category;
  if (!changedParent && next.every((row, i) => row.id === original[i]?.id)) return null;
  const changes: ChannelOrder["channels"] = positionChanges(next, item.id);
  if (changedParent) {
    const change = changes.find((row) => row.id === item.id);
    if (change) change.category_id = category;
    else changes.push({ id: item.id, position: moved.position, category_id: category });
  }
  return { categories: [], channels: changes };
}

export function canApplyResourceOrder(
  guildPermissions: readonly string[],
  categories: readonly GuildCategory[],
  channels: readonly GuildChannel[],
  order: ChannelOrder,
) {
  const managed = (item: { permissions: readonly string[] } | undefined) =>
    !!item?.permissions.includes("MANAGE_CHANNEL");
  return (
    order.categories.every((change) => managed(categories.find((item) => item.id === change.id))) &&
    order.channels.every((change) => {
      const channel = channels.find((item) => item.id === change.id);
      if (!managed(channel)) return false;
      if (change.category_id === undefined || change.category_id === (channel?.category_id ?? ""))
        return true;
      return change.category_id
        ? managed(categories.find((item) => item.id === change.category_id))
        : guildPermissions.includes("MANAGE_CHANNEL");
    })
  );
}

export function appendResourcePosition<T extends Positioned>(items: readonly T[]) {
  const sorted = sortResources(items);
  const last = sorted.at(-1)?.position ?? -100;
  if (last < 10000) return { position: Math.min(10000, last + 100), compact: [] as Positioned[] };
  return {
    position: sorted.length * 100,
    compact: sorted
      .map((item, i) => ({ id: item.id, position: i * 100 }))
      .filter((item, i) => item.position !== sorted[i].position),
  };
}
