import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { NavLink } from "@/components/nav-link";
import { getActiveAccount } from "@/lib/stripe/active-account";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Stripe Ops Agent",
  description: "AI agents for disputes, failed payments, and anomalies on Stripe. Test mode only.",
};

const NAV = [
  {
    group: "Operate",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/chat", label: "Ask" },
      { href: "/disputes", label: "Disputes" },
      { href: "/recovery", label: "Recovery" },
      { href: "/alerts", label: "Alerts" },
      { href: "/actions", label: "Actions" },
    ],
  },
  {
    group: "Analyze",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/briefs", label: "Briefs" },
      { href: "/rules", label: "Rules" },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/traces", label: "Traces" },
      { href: "/docs", label: "API docs" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const account = await getActiveAccount();
  const accountLabel =
    account.mode === "demo" ? "Demo account, read-only" : `Connected key ending ${account.connection.keyLast4}`;

  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <header className="flex h-10 items-center justify-between border-b px-4">
          <span className="font-semibold">Stripe Ops Agent</span>
          <span className="meta">
            {accountLabel} <span className="ml-2 border px-1.5 py-px text-[0.78rem] uppercase tracking-wide">Test mode</span>
          </span>
        </header>
        <div className="flex min-h-[calc(100vh-2.5rem)]">
          <nav className="w-44 shrink-0 border-r py-3">
            {NAV.map((section) => (
              <div key={section.group} className="mb-3">
                <p className="label px-3 pb-1">{section.group}</p>
                {section.items.map((item) => (
                  <NavLink key={item.href} href={item.href} label={item.label} />
                ))}
              </div>
            ))}
          </nav>
          <main className="min-w-0 flex-1 px-6 py-4">{children}</main>
        </div>
      </body>
    </html>
  );
}
