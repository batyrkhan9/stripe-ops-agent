// Human-readable labels shared by tools, cards, and pages. Dates are computed against "now", which is
// the seed anchor in demo mode (ADR 0001), so labels stay stable.

const DAY = 86_400;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function moneyLabel(minor: number | null | undefined, currency: string | null | undefined): string {
  if (minor == null) return "";
  const amount = (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (currency ?? "usd").toLowerCase() === "usd" ? `$${amount}` : `${amount} ${(currency ?? "").toUpperCase()}`;
}

export function dateLabel(unix: number | null | undefined, now?: number): string {
  if (!unix) return "";
  const date = new Date(unix * 1000);
  const label = `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
  const sameYear = now === undefined || new Date(now * 1000).getUTCFullYear() === date.getUTCFullYear();
  return sameYear ? label : `${label}, ${date.getUTCFullYear()}`;
}

// Whole calendar days between two instants, in UTC.
export function daysBetween(fromUnix: number, toUnix: number): number {
  const day = (unix: number) => Math.floor(unix / DAY);
  return day(toUnix) - day(fromUnix);
}

// "due Sep 25, in 9 days", "due today", "due tomorrow", "was due Sep 20, 3 days ago"
export function dueLabel(dueUnix: number | null | undefined, now: number): string {
  if (!dueUnix) return "";
  const days = daysBetween(now, dueUnix);
  const date = dateLabel(dueUnix, now);
  if (days === 0) return `due ${date}, today`;
  if (days === 1) return `due ${date}, tomorrow`;
  if (days > 1) return `due ${date}, in ${days} days`;
  return `was due ${date}, ${-days} day${days === -1 ? "" : "s"} ago`;
}

export function titleCase(snake: string | null | undefined): string {
  if (!snake) return "";
  const text = snake.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
