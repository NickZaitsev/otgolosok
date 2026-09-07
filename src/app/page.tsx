import { TourExperience } from "@/features/tour/tour-experience";
import type { Route } from "@/features/tour/types";
import route from "../../public/data/routes/paveletskaya.json";

export default function Home() {
  return <TourExperience route={route as Route} />;
}
