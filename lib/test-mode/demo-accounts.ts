/** The accounts the demo seed creates (prisma/seed*.ts), offered for one-click sign-in on a test-mode site. */
export const DEMO_ACCOUNTS = [
  { email: "admin@townmart.local", label: "TownMart admin", note: "Approves sellers, handles disputes and payouts", home: "/admin" },
  { email: "superadmin@townmart.local", label: "TownMart super admin", note: "Everything an admin can do, plus staff and settings", home: "/admin" },
  { email: "bola@demo.townmart.ng", label: "Bola, a shopper", note: "Has past orders and bookings", home: "/account" },
  { email: "emeka@cvgadgets.ng", label: "Mowe Gadget Hub", note: "Electronics seller", home: "/dashboard" },
  { email: "adaeze@ikejafreshmart.ng", label: "Mowe Fresh Mart", note: "Supermarket", home: "/dashboard" },
  { email: "bisola@yabathreads.ng", label: "Mowe Threads", note: "Fashion seller", home: "/dashboard" },
  { email: "tunde@ogunharvest.ng", label: "Ogun Harvest Farms", note: "Farm produce", home: "/dashboard" },
  { email: "titi@mamatiti.ng", label: "Mama Titi Couture", note: "Artisan (tailoring bookings)", home: "/dashboard" },
  { email: "chukwudi@fixitplumbing.ng", label: "Chukwudi FixIt Plumbing", note: "Plumbing service (bookings)", home: "/dashboard" },
] as const;
