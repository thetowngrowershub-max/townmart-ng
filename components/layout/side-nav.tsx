import { Badge } from "@/components/ui/badge";
import { CURRENT_PHASE, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { NavLink } from "./nav-link";

const itemClass = "flex items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2 text-sm";

export function SideNav({ items, label }: { items: NavItem[]; label: string }) {
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {items.map((item) => {
          const Icon = item.icon;
          if (item.phase > CURRENT_PHASE) {
            return (
              <li key={item.href}>
                <span className={cn(itemClass, "cursor-not-allowed text-muted-foreground/70")} aria-disabled="true">
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    Soon
                  </Badge>
                </span>
              </li>
            );
          }
          return (
            <li key={item.href}>
              <NavLink href={item.href} className={itemClass}>
                <Icon className="size-4" aria-hidden />
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
