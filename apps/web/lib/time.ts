/** A unix time as US Eastern time, for example "Fri 8:00 PM ET". The stock market keeps Eastern time. */
export function formatEastern(unix: number): string {
  const text = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(new Date(unix * 1000));
  return `${text} ET`;
}

/** A unix time in the viewer's own zone, for history rows. */
export function formatLocal(unix: number, lang: string): string {
  return new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(unix * 1000));
}
