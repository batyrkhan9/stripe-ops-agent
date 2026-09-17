import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Stripe Ops Agent",
  description: "AI agents for disputes, failed payments, and anomalies on Stripe. Test mode only.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/disputes", label: "Disputes" },
  { href: "/recovery", label: "Recovery" },
  { href: "/alerts", label: "Alerts" },
  { href: "/analytics", label: "Analytics" },
  { href: "/briefs", label: "Briefs" },
  { href: "/rules", label: "Rules" },
  { href: "/actions", label: "Actions" },
  { href: "/traces", label: "Traces" },
  { href: "/docs", label: "API docs" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="flex min-h-screen">
          <nav className="w-52 shrink-0 border-r p-4">
            <p className="mb-4 text-sm font-semibold">Stripe Ops Agent</p>
            <ul className="space-y-1 text-sm">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="block rounded px-2 py-1 hover:bg-muted">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-muted-foreground">Test mode only</p>
          </nav>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
