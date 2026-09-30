"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Menu, Package, Receipt, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  onOpenSidebar: () => void;
}

export function BottomNav({ onOpenSidebar }: BottomNavProps) {
  const pathname = usePathname();

  const isNavActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const linkClass = (href: string) =>
    cn(
      "flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium transition-colors",
      isNavActive(href) ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card/95 px-1 backdrop-blur lg:hidden safe-area-pb shadow-[0_-4px_16px_-8px_rgb(18_53_36_/_0.18)]"
      aria-label="Mobile navigation"
    >
      <Link href="/dashboard" className={linkClass("/dashboard")}>
        <LayoutDashboard className="size-5" />
        <span className="mt-0.5 truncate">Home</span>
      </Link>

      <Link href="/pos" className={linkClass("/pos")}>
        <MonitorSmartphone className="size-5" />
        <span className="mt-0.5 truncate">Sell</span>
      </Link>

      <Link href="/products" className={linkClass("/products")}>
        <Package className="size-5" />
        <span className="mt-0.5 truncate">Stock</span>
      </Link>

      <Link href="/invoices" className={linkClass("/invoices")}>
        <Receipt className="size-5" />
        <span className="mt-0.5 truncate">Invoices</span>
      </Link>

      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex flex-1 flex-col items-center justify-center py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-label="Open full menu"
      >
        <Menu className="size-5" />
        <span className="mt-0.5 truncate">More</span>
      </button>
    </nav>
  );
}
