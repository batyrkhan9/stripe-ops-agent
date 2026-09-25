import { timingSafeEqual } from "node:crypto";

// Vercel calls cron routes with "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET env var is set. With no
// secret configured the route refuses every call, so a forgotten env var fails closed rather than open.
export function isAuthorizedCron(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
