/** How a rider gets around. Safe for client components. */
export const RIDER_VEHICLES = ["motorbike", "tricycle", "bicycle", "car", "on_foot"] as const;
export type RiderVehicle = (typeof RIDER_VEHICLES)[number];
export const VEHICLE_LABELS: Record<RiderVehicle, string> = {
  motorbike: "Motorbike",
  tricycle: "Tricycle (keke)",
  bicycle: "Bicycle",
  car: "Car",
  on_foot: "On foot",
};
