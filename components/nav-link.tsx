"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block border-l-2 px-3 py-1 ${active ? "border-foreground bg-muted font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
    >
      {label}
    </Link>
  );
}
