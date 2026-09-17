// --spike adds disputes that Stripe cannot delete. Only allow it on an explicitly named account,
// so it can never land on the demo account by accident.
export function assertSpikeAllowed(accountId: string, allowedAccount: string | undefined): void {
  if (!allowedAccount) {
    throw new Error("--spike refused: SPIKE_ALLOWED_ACCOUNT is not set. Set it to a test account that is not the demo account.");
  }
  if (accountId !== allowedAccount) {
    throw new Error(`--spike refused: account ${accountId} does not match SPIKE_ALLOWED_ACCOUNT.`);
  }
}
