import { createAirouterLogger } from "@softmg/airouter-logs";

export function createBackendLogger({token=process.env.AIROUTER_LOGS_TOKEN,endpoint=process.env.AIROUTER_LOGS_ENDPOINT,environment=process.env.NODE_ENV??"development",fetch}={}) {
  if (!token?.trim()) return null;
  return createAirouterLogger({
    endpoint: endpoint || "https://airouter.softmg.tech",
    token,
    service: "otgolosok-backend",
    environment,
    ...(fetch ? {fetch} : {}),
    onError: () => console.error("Airouter logs delivery failed"),
  });
}
