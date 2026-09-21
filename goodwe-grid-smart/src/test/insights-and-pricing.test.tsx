import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ enabled: false }));

vi.mock("@/lib/backend/config", () => ({
  API_URL: "http://api.test",
  get backendEnabled() {
    return flags.enabled;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { LiveDataProvider, useLiveData } from "@/components/dashboard/LiveDataProvider";
import { DashboardInsights } from "@/components/dashboard/DashboardInsights";
import { MobilePricing } from "@/components/mobile/MobilePricing";

type Live = ReturnType<typeof useLiveData>;
let live: Live;
function Probe() {
  live = useLiveData();
  return null;
}

/** Entra sozinho como operador (demonstracao) assim que a API responde. */
function AutoLogin() {
  const { backend, loginDemo } = useLiveData();
  useEffect(() => {
    if (backend.status === "online" && !backend.operator) void loginDemo("operator");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.status]);
  return null;
}

const points = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  occupancy: hour === 12 ? 0.95 : 0.3,
  ev_load_kw: hour === 12 ? 76 : 24,
  total_demand_kw: hour === 12 ? 196 : 144,
  price_per_kwh: hour === 12 ? 1.96 : 1.37,
  band: hour === 12 ? "ponta" : "fora de ponta",
}));

const forecastPayload = {
  modelo: { version: 7, source: "csv", trained_at: "2026-09-20T10:00:00Z", rows: 343 },
  weekday: 4,
  weekday_name: "sexta",
  generated_at: "2026-09-18T15:00:00Z",
  points,
  summary: {
    peak_hour: 12, peak_occupancy: 0.95, min_price: 1.37, max_price: 1.96, avg_price: 1.4,
    saturation_hours: [12], saturation_alert: true, quietest_window_start: 0, quietest_window_end: 3,
  },
  now: { occupancy_predicted: 0.3, occupancy_live: 0.3, occupancy_used: 0.3, price_per_kwh: 1.37, band: "fora de ponta", source: "modelo" },
  weekday_index: [1.16, 1.18, 1.22, 1.27, 1.43, 0.38, 0.36],
  capacity_kw: 80, base_load_kw: 120, contracted_kw: 200, peak_occupancy_ref: 0.8, price_min: 1.1, price_max: 2.0,
  note: "Modelo estatistico. Nao e IA generativa.",
};

let calls: { method: string; path: string }[] = [];

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace("http://api.test", "");
      const method = init.method ?? "GET";
      calls.push({ method, path });
      const reply = (status: number, payload: unknown) => ({ ok: status < 400, status, statusText: "x", json: async () => payload });
      const body = init.body ? JSON.parse(init.body as string) : {};
      if (path === "/auth/demo-login") return reply(200, { access_token: `tok-${body.role}`, role: body.role, name: "x", user_id: 1 });
      if (path === "/auth/me") return reply(200, { id: 2, name: "Operador GoodWe", email: "operador@chargegrid.demo", role: "operator" });
      if (path === "/health")
        return reply(200, { status: "ok", version: "0.2.0", env: "development", database: { ok: true, engine: "postgresql" }, goodwe: { origem: "simulado" } });
      if (path === "/stations") return reply(200, [{ id: 1, name: "FIAP Paulista", type: "comercial", chargers: [{ id: 2, code: "CG-002", name: "FIAP #2" }] }]);
      if (path.startsWith("/sessions?")) return reply(200, []);
      if (path === "/ai/forecast") return reply(200, forecastPayload);
      if (path === "/ai/retrain") return reply(200, { version: 8, source: "csv", trained_at: "2026-09-20T11:00:00Z", rows: 343 });
      return reply(404, { detail: "rota nao mockada" });
    }),
  );
}

beforeEach(() => {
  calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("IA & Previsao e tela de Precos (sem servidor)", () => {
  beforeEach(() => {
    flags.enabled = false;
  });

  it("mostra o modelo embutido, o preco agora e as faixas calculadas", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <LiveDataProvider>
        <MobilePricing onBack={() => undefined} />
      </LiveDataProvider>,
    );
    expect(screen.getByText("Preço agora")).toBeInTheDocument();
    expect(screen.getByText(/Preço = R\$ 1,10 \+ R\$ 0,90/)).toBeInTheDocument();
    expect(screen.getByText(/Modelo embutido \(sem servidor\)/)).toBeInTheDocument();
    // as tarifas antigas do design original (R$ 4,25 etc.) nao existem mais
    expect(screen.queryByText(/4,25/)).not.toBeInTheDocument();
    expect(screen.queryByText(/49%/)).not.toBeInTheDocument();
  });

  it("dashboard de IA mostra previsao, cartoes de insight calculados e o download do CSV", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(
      <LiveDataProvider>
        <DashboardInsights />
      </LiveDataProvider>,
    );
    expect(screen.getByText(/Previsão de Demanda e Preço/)).toBeInTheDocument();
    expect(screen.getByText("Modelo embutido (sem servidor)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /tarifas_horarias\.csv/ })).toBeInTheDocument();
    expect(screen.getByText("Padrão semanal")).toBeInTheDocument();
    expect(screen.getByText(/fim de semana consome cerca de \d+% menos/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retreinar modelo/ })).not.toBeInTheDocument(); // so com backend
    expect(screen.queryByText(/cresceu 23%/)).not.toBeInTheDocument(); // afirmacao inventada do design original
  });
});

describe("IA & Previsao com backend", () => {
  beforeEach(() => {
    flags.enabled = true;
  });

  it("usa a previsao do modelo treinado e sincroniza a tarifa dos carregadores", async () => {
    installFetch();
    render(
      <LiveDataProvider>
        <Probe />
        <DashboardInsights />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(live.forecast.origin).toBe("backend"));
    expect(live.forecast.modelLabel).toBe("Modelo v7 (CSV, 343 registros)");
    expect(screen.getByText("Modelo v7 (CSV, 343 registros)")).toBeInTheDocument();
    expect(screen.getByText(/Saturação prevista: 12h–13h/)).toBeInTheDocument();

    // carregadores livres passam a cobrar o preco do modelo (R$ 1,37); os que estao carregando ficam travados
    await waitFor(() => {
      const free = live.chargers.filter((c) => c.status === "available");
      expect(free.length).toBeGreaterThan(0);
      expect(free.every((c) => c.tariff === 1.37)).toBe(true);
    });
  });

  it("botao 'Retreinar modelo' chama o backend e atualiza a versao", async () => {
    installFetch();
    render(
      <LiveDataProvider>
        <Probe />
        <AutoLogin />
        <DashboardInsights />
      </LiveDataProvider>,
    );
    const button = await screen.findByRole("button", { name: /Retreinar modelo/ }, { timeout: 4000 });
    await waitFor(() => expect(live.backend.operator).toBeDefined());
    await act(async () => {
      fireEvent.click(button);
    });
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/ai/retrain")).toBe(true));
  });

  it("se a previsao da API falhar, cai no modelo local sem quebrar", async () => {
    installFetch();
    const original = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (url.endsWith("/ai/forecast") ? { ok: false, status: 500, statusText: "x", json: async () => ({}) } : original(url, init))));
    render(
      <LiveDataProvider>
        <Probe />
        <MobilePricing onBack={() => undefined} />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(live.backend.status).toBe("online"));
    expect(live.forecast.origin).toBe("local");
    expect(screen.getByText("Preço agora")).toBeInTheDocument();
  });
});
