import { buildCapacitorConfig } from "./mobile/capacitor-config";

// Read by the Capacitor CLI (`pnpm mobile:sync`); the native shell is described in docs/agents/mobile-app.md.
export default buildCapacitorConfig(process.env);
