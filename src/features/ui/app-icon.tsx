import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Footprints,
  Headphones,
  List,
  LoaderCircle,
  LocateFixed,
  Map,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Route,
  Search,
  SlidersHorizontal,
  UserRound,
  X,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

const icons = {
  "arrow-down": ArrowDown,
  "arrow-right": ArrowRight,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  close: X,
  edit: Pencil,
  external: ExternalLink,
  forward: RotateCw,
  headphones: Headphones,
  list: List,
  loader: LoaderCircle,
  locate: LocateFixed,
  map: Map,
  pause: Pause,
  play: Play,
  plus: Plus,
  rewind: RotateCcw,
  route: Route,
  search: Search,
  settings: SlidersHorizontal,
  user: UserRound,
  walk: Footprints,
} satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof icons;

type AppIconProps = Omit<LucideProps, "aria-hidden" | "focusable"> & {
  name: AppIconName;
};

export function AppIcon({ name, size = 24, strokeWidth = 1.8, ...props }: AppIconProps) {
  const Icon = icons[name];
  return <Icon aria-hidden="true" focusable="false" size={size} strokeWidth={strokeWidth} {...props} />;
}
