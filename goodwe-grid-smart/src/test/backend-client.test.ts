import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/backend/config", () => ({ API_URL: "http://api.test", backendEnabled: true }));

import { ApiError, backend } from "@/lib/backend/client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("cliente HTTP do backend", () => {
  const fetchMock = vi.fn();

  beforeEach(() => vi.stubGlobal("fetch", fetchMock));
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("chama a URL certa e envia o token no cabecalho Authorization", async () => {
    fetchMock.mockResolvedValue(json([]));
    await backend.invoices("abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/billing/invoices?limit=20");
    expect(init.headers.Authorization).toBe("Bearer abc123");
  });

  it("envia o corpo JSON do login de demonstracao, sem token", async () => {
    fetchMock.mockResolvedValue(json({ access_token: "t", role: "driver", name: "João", user_id: 2 }));
    await backend.demoLogin("driver");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/auth/demo-login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ role: "driver" });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("transforma o 'detail' da API em ApiError com o status HTTP", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Carregador indisponivel" }, 409));
    await expect(backend.connectCable("t", 1)).rejects.toMatchObject({
      status: 409,
      message: "Carregador indisponivel",
    });
  });

  it("servidor fora do ar vira ApiError status 0 com mensagem amigavel", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await backend.health().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/servidor/i);
  });
});
