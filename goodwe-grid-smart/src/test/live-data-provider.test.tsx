import { act, render, waitFor } from "@testing-library/react";
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

type Live = ReturnType<typeof useLiveData>;
let live: Live;
function Probe({ label }: { label?: string }) {
  const value = useLiveData();
  if (!label || label === "main") live = value;
  return null;
}

const sessionInput = {
  userName: "João S.",
  vehicle: "BYD Dolphin",
  targetPct: 80,
  departureTime: "18:30",
  priority: "eco" as const,
};

const apiSession = (over: Record<string, unknown> = {}) => ({
  id: 11,
  charger_id: 2,
  charger_code: "CG-002",
  charger_name: "FIAP #2",
  mode: "economico",
  price_per_kwh_snapshot: 1.77,
  ...over,
});

describe("LiveDataProvider sem backend (simulacao local)", () => {
  beforeEach(() => {
    flags.enabled = false;
  });

  it("aplicativo e dashboard compartilham UM estado quando aninhados sob o mesmo provider", () => {
    // Regressao: antes, MobileApp e WebDashboard (irmaos) criavam cada um a sua simulacao.
    let second: Live | undefined;
    function Second() {
      second = useLiveData();
      return null;
    }
    render(
      <LiveDataProvider>
        <Probe />
        <LiveDataProvider>
          <Second />
        </LiveDataProvider>
      </LiveDataProvider>,
    );
    expect(second).toBeDefined();

    act(() => live.startSession("CG-002", sessionInput));

    // o provider interno "enxerga" a sessao iniciada pelo externo: e o mesmo estado
    expect(second!.chargers.find((c) => c.id === "CG-002")?.status).toBe("preparing");
    expect(second!.activeSessions).toHaveLength(1);
  });

  it("nao chama a API e informa backend 'off'", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    expect(live.backend).toEqual({ enabled: false, status: "off" });
    act(() => live.startSession("CG-002", sessionInput));
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("LiveDataProvider com backend (FastAPI + Supabase)", () => {
  const calls: string[] = [];
  const fetchMock = vi.fn();

  const person = (role: string) => ({
    id: role === "operator" ? 2 : 1,
    name: role === "operator" ? "Operador GoodWe" : "Maria Souza",
    email: `${role}@chargegrid.demo`,
    role,
  });

  const route = (method: string, path: string, body: Record<string, string> = {}, auth = ""): unknown => {
    if (path === "/auth/demo-login") return { access_token: `tok-${body.role}`, role: body.role, name: "x", user_id: 1 };
    if (path === "/auth/login") return { access_token: `tok-${body.email.split("@")[0]}`, role: body.email.split("@")[0], name: "x", user_id: 1 };
    if (path === "/auth/signup") return { access_token: "tok-driver", role: "driver", name: body.name, user_id: 9 };
    if (path === "/auth/me") return person(auth.replace("Bearer tok-", ""));
    if (path === "/vehicles/me") return [{ id: 5, plate: "ABC1D23", model: "BYD Dolphin" }];
    if (path === "/health")
      return {
        status: "ok", version: "0.2.0", env: "development", database: { ok: true, engine: "postgresql" },
        goodwe: { origem: "simulado" }, demo_login: true,
      };
    if (path === "/stations")
      return [{ id: 1, name: "FIAP Paulista", type: "comercial", chargers: [{ id: 2, code: "CG-002", name: "FIAP #2" }] }];
    if (path === "/sessions?status=completed&limit=50") return [];
    if (path === "/sessions") return apiSession();
    if (path.endsWith("/pay")) return { id: 1, method: "pix", status: "aprovado", amount: 0, provider_ref: "SANDBOX-PIX-11" };
    if (path.endsWith("/receipt"))
      return {
        receipt_number: "CG-2026-000011",
        session_id: 11,
        energy_kwh: 0.5,
        price_per_kwh: 1.77,
        amount: 0.89,
        payment: null,
        origem: "sandbox",
        aviso: "",
        station_name: "FIAP Paulista",
        charger_code: "CG-002",
      };
    if (path === "/ops/peak-shaving") return { logged: true, log_id: 5 };
    if (path === "/billing/summary")
      return { daily_energy_kwh: 41.27, daily_revenue: 55.5, active_sessions: 1, available_chargers: 6, network_capacity_kw: 200, network_used_kw: 12 };
    if (path === "/users/me/loyalty")
      return {
        points: 340, tier: "Bronze", next_tier: "Prata", points_to_next_tier: 160,
        week_sessions: 2, week_goal: 3, week_goal_met: false, weeks_goal_met: 0,
        points_per_kwh: 10, weekly_goal_bonus: 50,
      };
    return apiSession(); // confirm-payment / rfid / cable / meter-values / stop
  };

  beforeEach(() => {
    flags.enabled = true;
    calls.length = 0;
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      const path = url.replace("http://api.test", "");
      calls.push(`${init.method ?? "GET"} ${path}`);
      const body = init.body ? JSON.parse(init.body as string) : {};
      const auth = (init.headers as Record<string, string>)?.Authorization ?? "";
      if (path === "/auth/login" && body.password !== "certa123") {
        return new Response(JSON.stringify({ detail: "E-mail ou senha invalidos" }), { status: 401 });
      }
      return new Response(JSON.stringify(route(init.method ?? "GET", path, body, auth)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  const mountOnline = async () => {
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(live.backend.status).toBe("online"));
  };

  /** Executa uma chamada que deve falhar e devolve a mensagem (sem deixar o act() do React rejeitar). */
  const failureOf = async (call: () => Promise<unknown>): Promise<string> => {
    let message = "";
    await act(async () => {
      try {
        await call();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    });
    return message;
  };

  const loginDriver = async () => {
    await act(async () => {
      await live.loginDemo("driver");
    });
  };

  it("conecta e carrega as estacoes SEM entrar sozinho (o login agora e do usuario)", async () => {
    await mountOnline();
    expect(calls.filter((c) => c.includes("/auth/"))).toEqual([]); // nenhum login automatico
    expect(calls).toContain("GET /stations");
    expect(live.backend.engine).toBe("postgresql"); // o rotulo da tela vem do banco real, nao de um texto fixo
    expect(live.backend.demoLogin).toBe(true); // /health informa que "Entrar como demonstracao" esta ligado
    expect(live.backend.driver).toBeUndefined();
    expect(live.backend.operator).toBeUndefined();
    expect(live.backend.operatorToken).toBeUndefined();
  });

  it("login real do motorista guarda o usuario, carrega veiculos e historico", async () => {
    await mountOnline();
    await act(async () => {
      await live.login("driver", "driver@chargegrid.demo", "certa123");
    });
    expect(live.backend.driver).toMatchObject({ name: "Maria Souza", email: "driver@chargegrid.demo" });
    await waitFor(() => expect(live.vehicles).toEqual([{ id: 5, plate: "ABC1D23", model: "BYD Dolphin" }]));
    expect(calls).toContain("GET /sessions?status=completed&limit=50");
    await waitFor(() => expect(live.loyalty).toMatchObject({ points: 340, tier: "Bronze", week_sessions: 2 }));
  });

  it("sair apaga a pontuacao (assim como veiculos e historico)", async () => {
    await mountOnline();
    await act(async () => {
      await live.login("driver", "driver@chargegrid.demo", "certa123");
    });
    await waitFor(() => expect(live.loyalty).not.toBeNull());
    act(() => live.logout("driver"));
    expect(live.loyalty).toBeNull();
  });

  it("energia e faturamento de hoje vem do banco quando ha operador logado (e sao 'simulado' antes)", async () => {
    await mountOnline();
    expect(live.totals.source).toBe("simulado");
    await act(async () => {
      await live.login("operator", "operator@chargegrid.demo", "certa123");
    });
    await waitFor(() => expect(live.totals.source).toBe("banco"));
    expect(live.totals.kwhToday).toBe(41.3);
    expect(live.totals.revenueToday).toBe(55.5);
    expect(calls).toContain("GET /billing/summary");
    act(() => live.logout("operator"));
    await waitFor(() => expect(live.totals.source).toBe("simulado"));
  });

  it("senha errada mostra a mensagem do servidor e nao entra", async () => {
    await mountOnline();
    expect(await failureOf(() => live.login("driver", "driver@chargegrid.demo", "errada"))).toBe("E-mail ou senha invalidos");
    expect(live.backend.driver).toBeUndefined();
  });

  it("conta de motorista nao entra no console do operador (e vice-versa)", async () => {
    await mountOnline();
    expect(await failureOf(() => live.login("operator", "driver@chargegrid.demo", "certa123"))).toContain("não tem acesso de operador");
    expect(live.backend.operator).toBeUndefined();
    expect(await failureOf(() => live.login("driver", "operator@chargegrid.demo", "certa123"))).toContain("conta é de operador");
    expect(live.backend.driver).toBeUndefined();
  });

  it("cadastro cria a conta de motorista e ja entra", async () => {
    await mountOnline();
    await act(async () => {
      await live.signup("Ana Paula", "ana@example.com", "senha1234");
    });
    expect(calls).toContain("POST /auth/signup");
    expect(live.backend.driver).toBeDefined();
  });

  it("sair apaga o usuario, os veiculos e o historico da tela", async () => {
    await mountOnline();
    await loginDriver();
    await waitFor(() => expect(live.vehicles).toHaveLength(1));
    act(() => live.logout("driver"));
    expect(live.backend.driver).toBeUndefined();
    expect(live.vehicles).toEqual([]);
    expect(live.apiHistory).toEqual([]);
  });

  it("sem login de motorista a recarga fica so na simulacao local (nada e gravado)", async () => {
    await mountOnline();
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.logs.some((l) => l.msg.includes("sem login de motorista"))).toBe(true));
    expect(calls).not.toContain("POST /sessions");
    expect(live.persistedSessionIds["CG-002"]).toBeUndefined();
    expect(live.chargers.find((c) => c.id === "CG-002")?.status).toBe("preparing"); // a simulacao segue
  });

  it("iniciar recarga percorre a maquina de estados A -> B -> C e grava o id da sessao", async () => {
    await mountOnline();
    await loginDriver();
    act(() => live.startSession("CG-002", { ...sessionInput, vehicleId: 5 }));

    await waitFor(() => expect(live.persistedSessionIds["CG-002"]).toBe(11));

    const journey = calls.slice(calls.indexOf("POST /sessions")).filter((c) => c.startsWith("POST"));
    expect(journey.slice(0, 4)).toEqual([
      "POST /sessions",
      "POST /sessions/11/confirm-payment",
      "POST /sessions/11/authenticate-rfid?approved=true",
      "POST /sessions/11/connect-cable",
    ]);
    expect(calls).toContain("POST /sessions"); // e o veiculo do perfil segue no corpo (vehicle_id)
    // a tarifa local passa a ser a do backend (a mesma que sera cobrada)
    expect(live.chargers.find((c) => c.id === "CG-002")?.tariff).toBe(1.77);
  });

  it("finalizar recarga paga (sandbox), encerra e guarda o comprovante no historico", async () => {
    await mountOnline();
    await loginDriver();
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.persistedSessionIds["CG-002"]).toBe(11));

    act(() => live.endSession("CG-002"));

    await waitFor(() => expect(live.completedSessions[0]?.receipt).toBe("CG-2026-000011"));
    const end = calls.slice(calls.indexOf("POST /sessions/11/connect-cable") + 1);
    expect(end.filter((c) => !c.startsWith("GET"))).toEqual([
      "POST /sessions/11/meter-values",
      "POST /sessions/11/pay",
      "POST /sessions/11/stop",
    ]);
    expect(live.completedSessions[0]).toMatchObject({ sessionId: 11, kwh: 0.5, cost: 0.89 });
    expect(live.persistedSessionIds["CG-002"]).toBeUndefined();
  });

  it("peak shaving e registrado na auditoria do backend quando ha operador logado", async () => {
    await mountOnline();
    await act(async () => {
      await live.loginDemo("operator");
    });
    expect(live.backend.operatorToken).toBe("tok-operator");
    act(() => live.applyPeakShaving());
    await waitFor(() => expect(calls).toContain("POST /ops/peak-shaving"));
  });

  it("sem operador logado o peak shaving so acontece na simulacao local (nao chama a auditoria)", async () => {
    await mountOnline();
    act(() => live.applyPeakShaving());
    expect(live.peakShavingActive).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).not.toContain("POST /ops/peak-shaving");
  });

  it("se a API estiver fora do ar, o app segue em simulacao local sem quebrar", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(live.backend.status).toBe("error"));

    act(() => live.startSession("CG-002", sessionInput));
    expect(live.chargers.find((c) => c.id === "CG-002")?.status).toBe("preparing");
    act(() => live.endSession("CG-002"));
    expect(live.completedSessions).toHaveLength(1);
    expect(live.completedSessions[0].sessionId).toBeUndefined();
  });
});

describe("simulacao local acompanha a ocupacao prevista pelo modelo", () => {
  beforeEach(() => {
    flags.enabled = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function runTicks(n: number) {
    for (let i = 0; i < n; i++) act(() => void vi.advanceTimersByTime(2000));
  }
  const charging = () => live.chargers.filter((c) => c.status === "charging");
  const evKw = () => live.chargers.reduce((s, c) => s + c.currentPower, 0);

  it("sexta ao meio-dia (pico previsto): varios carregando e potencia perto da previsao", () => {
    vi.setSystemTime(new Date("2026-09-18T15:00:00Z")); // sexta, 12h em Sao Paulo
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    const predictedKw = live.forecast.now.occupancyPredicted * 80;
    expect(predictedKw).toBeGreaterThan(60);
    runTicks(90);
    expect(charging().length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(evKw() - predictedKw)).toBeLessThan(25);
  });

  it("domingo de madrugada (previsao baixa): quase nada carregando e potencia baixa", () => {
    vi.setSystemTime(new Date("2026-09-20T06:00:00Z")); // domingo, 3h em Sao Paulo
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    const predictedKw = live.forecast.now.occupancyPredicted * 80;
    expect(predictedKw).toBeLessThan(15);
    runTicks(90);
    expect(charging().length).toBeLessThanOrEqual(2);
    expect(evKw()).toBeLessThan(predictedKw + 20);
  });

  it("uma recarga iniciada pelo app nao e encerrada pela simulacao de fundo", () => {
    vi.setSystemTime(new Date("2026-09-20T06:00:00Z"));
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    act(() => live.startSession("CG-002", sessionInput));
    runTicks(30);
    const mine = live.chargers.find((c) => c.id === "CG-002");
    expect(mine?.user).toBe("João S.");
    expect(["preparing", "charging"]).toContain(mine?.status);
  });
});
