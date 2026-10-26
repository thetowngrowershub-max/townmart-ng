import type { LucideIcon } from "lucide-react";
import {
  BadgePercent,
  BarChart3,
  Bell,
  CalendarCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Gavel,
  Heart,
  LayoutDashboard,
  MapPin,
  MessageSquare,
  Package,
  Palette,
  RotateCcw,
  Scale,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";

/**
 * `phase` is the build phase that ships the page. Items from later phases are
 * shown in the sidebar as "coming soon" (not links) so the shell shows the
 * whole information architecture without dead links.
 */
export type NavItem = { href: string; label: string; icon: LucideIcon; phase: number };

export const CURRENT_PHASE = 5;

export const accountNav: NavItem[] = [
  { href: "/account", label: "Overview", icon: LayoutDashboard, phase: 0 },
  { href: "/account/orders", label: "Orders", icon: Package, phase: 3 },
  { href: "/account/bookings", label: "Bookings", icon: CalendarCheck, phase: 4 },
  { href: "/account/addresses", label: "Addresses", icon: MapPin, phase: 3 },
  { href: "/account/wishlist", label: "Wishlist", icon: Heart, phase: 4 },
  { href: "/account/reviews", label: "Reviews", icon: Star, phase: 4 },
  { href: "/account/refunds", label: "Refunds & returns", icon: RotateCcw, phase: 5 },
  { href: "/account/notifications", label: "Notifications", icon: Bell, phase: 3 },
  { href: "/account/payments", label: "Payment history", icon: CreditCard, phase: 3 },
  { href: "/account/privacy", label: "Privacy Centre", icon: ShieldCheck, phase: 6 },
  { href: "/account/security", label: "Profile & security", icon: Settings, phase: 0 },
];

export const dashboardNav: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, phase: 0 },
  { href: "/dashboard/products", label: "Products", icon: Package, phase: 1 },
  { href: "/dashboard/services", label: "Services", icon: Wrench, phase: 1 },
  { href: "/dashboard/promotions", label: "Promotions", icon: BadgePercent, phase: 2 },
  { href: "/dashboard/orders", label: "Orders", icon: ClipboardList, phase: 4 },
  { href: "/dashboard/bookings", label: "Bookings", icon: CalendarCheck, phase: 4 },
  { href: "/dashboard/refunds", label: "Refunds & disputes", icon: RotateCcw, phase: 5 },
  { href: "/dashboard/payouts", label: "Payouts", icon: Wallet, phase: 5 },
  { href: "/dashboard/reviews", label: "Reviews", icon: Star, phase: 4 },
  { href: "/dashboard/messages", label: "Messages", icon: MessageSquare, phase: 4 },
  { href: "/dashboard/staff", label: "Staff", icon: Users, phase: 7 },
  { href: "/dashboard/settings", label: "Store settings", icon: Store, phase: 1 },
];

export const adminNav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, phase: 0 },
  { href: "/admin/sellers", label: "Seller approvals", icon: Store, phase: 1 },
  { href: "/admin/moderation", label: "Moderation", icon: Gavel, phase: 7 },
  { href: "/admin/orders", label: "Orders & disputes", icon: ClipboardList, phase: 5 },
  { href: "/admin/payouts", label: "Refunds & payouts", icon: Wallet, phase: 5 },
  { href: "/admin/content", label: "Content (CMS)", icon: FileText, phase: 7 },
  { href: "/admin/compliance", label: "Compliance centre", icon: Scale, phase: 6 },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3, phase: 7 },
  { href: "/admin/users", label: "Users & roles", icon: Users, phase: 7 },
  { href: "/design-system", label: "Design system", icon: Palette, phase: 0 },
];

export const storefrontCategories = [
  { slug: "groceries", label: "Groceries", emoji: "🛒" },
  { slug: "fashion", label: "Fashion", emoji: "👗" },
  { slug: "electronics", label: "Electronics", emoji: "📱" },
  { slug: "home", label: "Home", emoji: "🛋️" },
  { slug: "farm-produce", label: "Farm Produce", emoji: "🌽" },
  { slug: "beauty", label: "Beauty", emoji: "💄" },
  { slug: "services", label: "Services", emoji: "🧰" },
  { slug: "artisans", label: "Artisans", emoji: "🪡" },
] as const;

export const footerLinks: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: "TownMart",
    links: [
      { href: "/about", label: "About" },
      { href: "/sell", label: "Sell on TownMart" },
      { href: "/help", label: "Help centre" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    heading: "Policies",
    links: [
      { href: "/legal/terms", label: "Terms of Use" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/cookies", label: "Cookie Policy" },
      { href: "/legal/refunds", label: "Refund & Returns" },
      { href: "/legal/shipping", label: "Shipping & Delivery" },
      { href: "/legal/promotions", label: "Promotions & Coupons" },
    ],
  },
  {
    heading: "Sellers",
    links: [
      { href: "/legal/seller-agreement", label: "Seller Agreement" },
      { href: "/legal/service-provider-terms", label: "Service Provider Terms" },
      { href: "/legal/prohibited-items", label: "Prohibited Items" },
      { href: "/legal/dpa", label: "Data Processing Agreement" },
    ],
  },
  {
    heading: "Your data",
    links: [
      { href: "/legal/data-request", label: "Data request" },
      { href: "/legal/acceptable-use", label: "Acceptable Use" },
      { href: "/legal/accessibility", label: "Accessibility" },
      { href: "/legal/company", label: "Company information" },
    ],
  },
];
