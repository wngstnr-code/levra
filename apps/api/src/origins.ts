/**
 * Allowed web origins and sign-in hosts (BE-56), from comma-separated lists. A `*` stands for one part of a host name
 * made of letters, digits and dashes, never a dot, so `https://levra-*-team.vercel.app` matches this project's preview
 * addresses and not every site on vercel.app.
 */
export function parsePatterns(list: string | undefined): RegExp[] {
  return (list ?? "")
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.split("*").map(escape).join("[a-z0-9-]+")}$`));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

export const matchesAny = (patterns: RegExp[], value: string) => patterns.some((p) => p.test(value.toLowerCase()));
