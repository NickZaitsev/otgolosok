import type { Coordinates } from "../tour/types";

export type ParkingAccess = "public" | "unknown";

export type ParkingPlace = {
  id: string;
  name: string;
  location: Coordinates;
  entrance: Coordinates;
  exit: Coordinates;
  pedestrianAccess: Coordinates;
  access: ParkingAccess;
  fee: boolean | null;
  openingHours: string | null;
};

export type ParkingSource = {
  sourceEditedAt: string;
  attribution: string;
};

export type NearbyParking = ParkingSource & { places: ParkingPlace[] };
