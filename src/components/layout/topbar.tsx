"use client";

import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/layout/global-search";
import { UserMenu } from "@/components/layout/user-menu";
import { AccessModeSwitcher } from "@/components/layout/access-mode-switcher";
import { TechnicLogo } from "@/components/shared/technic-logo";
import type { TaxMode, UserRole } from "@/generated/prisma/enums";

interface TopbarProps {
  name: string;
  email: string;
  role: UserRole;
  branchName: string | null;
  firmName: string | null;
  accessMode: TaxMode;
  canSwitchMode: boolean;
  onOpenSidebar: () => void;
}

export function Topbar({
  name,
  email,
  role,
  branchName,
  firmName,
  accessMode,
  canSwitchMode,
  onOpenSidebar,
}: TopbarProps) {
  return (
    <header className="sticky top-3 z-30 mb-4 flex h-16 items-center gap-2 rounded-2xl border border-border bg-card px-3 shadow-sm sm:top-4 sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu />
      </Button>

      <div className="mr-1 flex shrink-0 items-center gap-2 lg:hidden">
        <Link href="/dashboard" className="flex items-center">
          <TechnicLogo size={22} theme="auto" />
        </Link>
      </div>

      <div className="hidden min-w-0 flex-col lg:flex">
        <span className="truncate text-sm font-semibold leading-tight">{firmName ?? "Technic Technologies"}</span>
        <span className="text-xs leading-tight text-muted-foreground">{branchName ?? "All branches"}</span>
      </div>

      <div className="min-w-0 flex-1">
        <GlobalSearch />
      </div>

      <AccessModeSwitcher mode={accessMode} canSwitch={canSwitchMode} />

      <UserMenu name={name} email={email} role={role} branchName={branchName} />
    </header>
  );
}
