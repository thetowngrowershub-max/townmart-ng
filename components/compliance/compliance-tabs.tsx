import { SectionTabs } from "@/components/admin/section-tabs";

const TABS = [
  { href: "/admin/compliance", label: "Overview" },
  { href: "/admin/compliance/requests", label: "Data requests" },
  { href: "/admin/compliance/breaches", label: "Breaches" },
  { href: "/admin/compliance/records", label: "RoPA & DPIAs" },
  { href: "/admin/compliance/retention", label: "Retention" },
  { href: "/admin/compliance/legal", label: "Legal pages" },
  { href: "/admin/compliance/logs", label: "Consent & access logs" },
];

export function ComplianceTabs() {
  return <SectionTabs label="Compliance centre" tabs={TABS} />;
}
