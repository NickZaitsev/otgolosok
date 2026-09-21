import { describe, expect, it, vi } from "vitest";
import { RejectedRequest, request } from "./request";

describe("ограниченный транспорт конструктора", () => {
  it("повторяет временный сетевой сбой тем же запросом", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const body = { recoveryToken: "stable-key" };
    await expect(request("/api/walk-research-jobs", new AbortController().signal, body)).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(body) });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify(body) });
  });

  it("не повторяет детерминированный отказ клиента", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Проверьте данные" } }), { status: 400 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(request("/api/walk-research-jobs", new AbortController().signal, { recoveryToken: "stable-key" })).rejects.toBeInstanceOf(RejectedRequest);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
