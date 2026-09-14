export class RequestError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}
export class RejectedRequest extends RequestError {}
export const shouldOfferResearch = (selection: "auto" | "manual", error: unknown) => selection === "auto" && error instanceof RequestError && ["WALK_STOPS_NOT_FOUND", "WALK_NOT_FOUND"].includes(error.code);

export async function request(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal.addEventListener("abort", relay, { once: true });
  if (signal.aborted) relay();
  const timer = setTimeout(relay, 20000);
  try {
    const response = await fetch(path, { signal: controller.signal, cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) {
      const ErrorType = response.status >= 400 && response.status < 500 ? RejectedRequest : RequestError;
      throw new ErrorType(value.error?.message ?? "Сервис недоступен. Повторите действие позже.", value.error?.code ?? "SERVICE_UNAVAILABLE", response.status);
    }
    return value;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new Error("Время ожидания истекло. Проверьте соединение.");
    throw error;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", relay); }
}
