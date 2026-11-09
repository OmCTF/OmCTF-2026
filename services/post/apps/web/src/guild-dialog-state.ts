import type { Permission } from "../../../packages/contracts/generated/ts/models";

export type PermissionMode = "deny" | "inherit" | "allow";
export type PermissionOverrides = { allow: Permission[]; deny: Permission[] };

type ChoiceField = { options: readonly { value: string }[]; required?: boolean };

export function initialChoice(field: ChoiceField & { value?: string | number }) {
  const value = String(field.value ?? "");
  return field.options.some((option) => option.value === value)
    ? value
    : (field.options[0]?.value ?? "");
}

export function validChoice(field: ChoiceField, value: string) {
  return (
    (!field.required || value !== "") && field.options.some((option) => option.value === value)
  );
}

export function permissionMode(value: PermissionOverrides, permission: Permission): PermissionMode {
  if (value.deny.includes(permission)) return "deny";
  return value.allow.includes(permission) ? "allow" : "inherit";
}

export function setPermissionMode(
  value: PermissionOverrides,
  permission: Permission,
  mode: PermissionMode,
): PermissionOverrides {
  const allow = value.allow.filter((p) => p !== permission);
  const deny = value.deny.filter((p) => p !== permission);
  if (mode === "allow") allow.push(permission);
  if (mode === "deny") deny.push(permission);
  return { allow, deny };
}
