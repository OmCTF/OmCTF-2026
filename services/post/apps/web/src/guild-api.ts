export function inviteCodeFromInput(value: string): string {
  const input = value.trim();
  return input.includes("#")
    ? (new URLSearchParams(input.slice(input.indexOf("#") + 1)).get("invite") ?? "")
    : input;
}
export function revisionHeaders(revision: number): Record<string, string> {
  if (!Number.isSafeInteger(revision) || revision < 1) throw Error("Обновите данные сервера.");
  return { "If-Match": `"${revision}"` };
}
