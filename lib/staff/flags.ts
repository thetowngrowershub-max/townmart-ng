/** Staff permission flags an owner can give (business_staff.permissions). See STAFF_FLAG in lib/authz. */
export const STAFF_FLAGS = [
  { key: "inventory", label: "Products and services", hint: "Add and edit listings, stock and CSV imports." },
  { key: "orders", label: "Orders", hint: "See and fulfil orders, and message customers about them." },
  { key: "bookings", label: "Bookings", hint: "Manage appointments and the booking calendar." },
  { key: "promotions", label: "Promotions", hint: "Create discounts and coupon codes." },
  { key: "reviews", label: "Reviews and questions", hint: "Reply to reviews and answer shoppers' questions." },
] as const;

export type StaffFlag = (typeof STAFF_FLAGS)[number]["key"];

/** Keeps only known flags that are on. */
export function cleanFlags(input: Record<string, unknown>): Record<StaffFlag, true> {
  return Object.fromEntries(STAFF_FLAGS.filter((f) => input[f.key] === true).map((f) => [f.key, true])) as Record<StaffFlag, true>;
}

/** Days an invitation link stays valid. */
export const INVITE_DAYS = 7;
