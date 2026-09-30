import {
  ArrowLeftRight,
  BadgePercent,
  Boxes,
  ClipboardList,
  FileBarChart,
  FileText,
  LayoutDashboard,
  MonitorSmartphone,
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Undo2,
  User,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import { PERMISSIONS, type PermissionCode } from "@/lib/rbac";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The user needs at least one of these to see the item. */
  permissions: PermissionCode[];
  /** Match sub-routes as active too. */
  exact?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Technic Technologies ERP navigation, following the handover's sidebar order:
 * Dashboard → Sales → Purchases → Inventory → Partners → Money → Warranty →
 * Reports → Administration.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        permissions: [PERMISSIONS.DASHBOARD_VIEW],
        exact: true,
      },
    ],
  },
  {
    label: "SALES",
    items: [
      {
        label: "Point of Sale",
        href: "/pos",
        icon: MonitorSmartphone,
        permissions: [PERMISSIONS.SALES_CREATE, PERMISSIONS.INVOICE_CREATE],
      },
      {
        label: "Invoices",
        href: "/invoices",
        icon: Receipt,
        permissions: [PERMISSIONS.INVOICE_VIEW],
      },
      {
        label: "Quotations",
        href: "/quotations",
        icon: FileText,
        permissions: [PERMISSIONS.QUOTATION_VIEW],
      },
      {
        label: "Sales Orders",
        href: "/sales-orders",
        icon: ClipboardList,
        permissions: [PERMISSIONS.SALES_VIEW],
      },
      {
        label: "Sales Returns",
        href: "/sales-returns",
        icon: Undo2,
        permissions: [PERMISSIONS.SALES_VIEW],
      },
      {
        label: "Payments",
        href: "/payments",
        icon: Wallet,
        permissions: [PERMISSIONS.PAYMENTS_VIEW],
      },
    ],
  },
  {
    label: "PURCHASES",
    items: [
      {
        label: "Purchase Orders",
        href: "/purchases",
        icon: ShoppingCart,
        permissions: [PERMISSIONS.PURCHASE_VIEW],
      },
      {
        label: "Purchase Bills",
        href: "/purchases/bills",
        icon: FileText,
        permissions: [PERMISSIONS.PURCHASE_VIEW],
      },
      {
        label: "Purchase Returns",
        href: "/purchases/returns",
        icon: Undo2,
        permissions: [PERMISSIONS.PURCHASE_VIEW],
      },
      {
        label: "Suppliers",
        href: "/suppliers",
        icon: Truck,
        permissions: [PERMISSIONS.SUPPLIERS_VIEW],
      },
    ],
  },
  {
    label: "INVENTORY",
    items: [
      {
        label: "Products",
        href: "/products",
        icon: Package,
        permissions: [PERMISSIONS.PRODUCT_VIEW],
      },
      {
        label: "Stock",
        href: "/inventory",
        icon: Boxes,
        permissions: [PERMISSIONS.INVENTORY_VIEW],
      },
      {
        label: "Serial Numbers",
        href: "/serials",
        icon: BadgePercent,
        permissions: [PERMISSIONS.SERIALS_VIEW],
      },
      {
        label: "Stock Adjustments",
        href: "/inventory/adjustments",
        icon: Wrench,
        permissions: [PERMISSIONS.INVENTORY_ADJUST],
      },
      {
        label: "Stock Transfers",
        href: "/inventory/transfers",
        icon: ArrowLeftRight,
        permissions: [PERMISSIONS.INVENTORY_TRANSFER],
      },
    ],
  },
  {
    label: "PARTNERS",
    items: [
      {
        label: "Customers",
        href: "/customers",
        icon: Users,
        permissions: [PERMISSIONS.CUSTOMERS_VIEW],
      },
    ],
  },
  {
    label: "BUSINESS",
    items: [
      {
        label: "Expenses",
        href: "/expenses",
        icon: Wallet,
        permissions: [PERMISSIONS.EXPENSES_VIEW],
      },
      {
        label: "Warranty",
        href: "/warranty",
        icon: ShieldCheck,
        permissions: [PERMISSIONS.WARRANTY_VIEW],
      },
      {
        label: "Reports",
        href: "/reports",
        icon: FileBarChart,
        permissions: [PERMISSIONS.REPORTS_VIEW],
      },
    ],
  },
  {
    label: "ADMINISTRATION",
    items: [
      {
        label: "Users",
        href: "/users",
        icon: User,
        permissions: [PERMISSIONS.USERS_VIEW],
      },
      {
        label: "Roles & Permissions",
        href: "/users/roles",
        icon: ShieldCheck,
        permissions: [PERMISSIONS.ROLES_MANAGE],
      },
      {
        label: "Firms",
        href: "/firms",
        icon: Settings,
        permissions: [PERMISSIONS.FIRMS_VIEW],
      },
      {
        label: "Access Codes",
        href: "/access-codes",
        icon: BadgePercent,
        permissions: [PERMISSIONS.ACCESS_CODES_MANAGE],
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
        permissions: [PERMISSIONS.SETTINGS_MANAGE],
      },
      {
        label: "Audit Logs",
        href: "/audit",
        icon: FileBarChart,
        permissions: [PERMISSIONS.AUDIT_VIEW],
      },
    ],
  },
];

export const MOBILE_BOTTOM_NAV: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    permissions: [PERMISSIONS.DASHBOARD_VIEW],
    exact: true,
  },
  {
    label: "POS",
    href: "/pos",
    icon: MonitorSmartphone,
    permissions: [PERMISSIONS.SALES_CREATE, PERMISSIONS.INVOICE_CREATE],
  },
  {
    label: "Products",
    href: "/products",
    icon: Package,
    permissions: [PERMISSIONS.PRODUCT_VIEW],
  },
  {
    label: "Invoices",
    href: "/invoices",
    icon: Receipt,
    permissions: [PERMISSIONS.INVOICE_VIEW],
  },
  {
    label: "More",
    href: "/menu",
    icon: Settings,
    permissions: [],
  },
];

export function visibleSections(permissions: PermissionCode[]): NavSection[] {
  const has = (item: NavItem) =>
    item.permissions.length === 0 || item.permissions.some((code) => permissions.includes(code));

  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(has),
  })).filter((section) => section.items.length > 0);
}
