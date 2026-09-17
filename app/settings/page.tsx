import { Button } from "@/components/ui/button";
import { getActiveAccount } from "@/lib/stripe/active-account";
import { READ_PERMISSIONS, WRITE_PERMISSIONS, type KeyPermissions } from "@/lib/stripe/permissions";
import { connectKey, disconnectKey } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  full_secret_key: "That is a full secret key. Create a restricted key (rk_test_) with only the permissions you want to grant.",
  live_key: "Only test mode restricted keys (rk_test_) are accepted.",
  malformed: "That does not look like a Stripe restricted key (rk_test_).",
  rejected_by_stripe: "Stripe rejected this key. Check that it is active and copied in full.",
  stripe_unreachable: "Could not reach Stripe to check the key. Try again.",
  missing_reads: "This key is missing read access the agent needs:",
};

function PermissionList({ permissions }: { permissions: KeyPermissions }) {
  return (
    <table className="data-table max-w-md">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Read</th>
          <th>Write</th>
        </tr>
      </thead>
      <tbody>
        {READ_PERMISSIONS.map((p) => (
          <tr key={p}>
            <td className="capitalize">{p}</td>
            <td>{permissions.read[p] ? "Yes" : "No"}</td>
            <td>{(WRITE_PERMISSIONS as readonly string[]).includes(p) ? (permissions.write[p as (typeof WRITE_PERMISSIONS)[number]] ? "Yes" : "No") : ""}</td>
          </tr>
        ))}
        <tr>
          <td>Coupons</td>
          <td></td>
          <td>{permissions.write.coupons ? "Yes" : "No"}</td>
        </tr>
      </tbody>
    </table>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; missing?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const account = await getActiveAccount();
  const missing = (params.missing ?? "").split(",").filter((p) => (READ_PERMISSIONS as readonly string[]).includes(p));

  return (
    <div className="max-w-3xl space-y-6">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <section className="space-y-2">
        <h2>Current account</h2>
        {account.mode === "demo" ? (
          <p>
            Demo account (read-only). Everything you see is seeded test data. Connect your own test account below.
          </p>
        ) : (
          <div className="space-y-3">
            <p>
              Your restricted key ending in {account.connection.keyLast4}
              {account.connection.accountId ? ` on ${account.connection.accountId}` : ""}.{" "}
              {account.canWrite ? "Writes are possible after you confirm each one." : "Read-only: the agent cannot change anything."}
            </p>
            <PermissionList permissions={account.connection.permissions} />
            <form action={disconnectKey}>
              <Button type="submit" variant="outline">Disconnect and delete key</Button>
            </form>
          </div>
        )}
        {params.connected && <p className="font-medium">Key connected.</p>}
      </section>

      <section className="space-y-3">
        <h2>Connect a Stripe test account</h2>
        <p className="max-w-2xl text-muted-foreground">
          In the Stripe Dashboard, create a restricted key in test mode. Grant Read on Charges, Customers, Subscriptions,
          Invoices, Disputes, Refunds, and Balance. To let the agent propose actions you can confirm, also grant Write
          on any of Refunds, Coupons, Subscriptions, or Disputes. Leave everything else as None.
        </p>
        <p className="max-w-2xl text-muted-foreground">
          The key is checked without changing any data, stored encrypted, never shown to the AI model, and deleted when
          you disconnect.
        </p>
        {params.error && (
          <p className="alert-row alert-text px-2 py-1.5" role="alert">
            {ERRORS[params.error] ?? "Something went wrong."} {params.error === "missing_reads" && missing.join(", ")}
          </p>
        )}
        <form action={connectKey} className="flex max-w-2xl gap-2">
          <input
            name="key"
            type="password"
            autoComplete="off"
            required
            placeholder="rk_test_..."
            className="h-7 flex-1 rounded-sm border border-input px-2 font-mono text-[0.86rem]"
          />
          <Button type="submit">Check and connect</Button>
        </form>
      </section>
    </div>
  );
}
