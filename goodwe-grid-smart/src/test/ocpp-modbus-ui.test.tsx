import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/lib/backend/config", () => ({
  API_URL: "http://api.test",
  get backendEnabled() {
    return flags.enabled;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { LiveDataProvider, useLiveData } from "@/components/dashboard/LiveDataProvider";
import { DashboardLogs, compactPayload, ocppLabel } from "@/components/dashboard/DashboardLogs";
import { DashboardMeter } from "@/components/dashboard/DashboardMeter";

type Live = ReturnType<typeof useLiveData>;
let live: Live;
function Probe() {
  live = useLiveData();
  return null;
}
function AutoLogin({ role }: { role: "driver" | "operator" }) {
  const { backend, loginDemo } = useLiveData();
  useEffect(() => {
    if (backend.status === "online" && !backend[role]) void loginDemo(role);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend.status]);
  return null;
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace("Z", "");
let messages: unknown[] = [];
let ocppStatus = { enabled: true, auth_required: false, simulator: true, protocol: "OCPP 1.6J", connected: [] as unknown[] };
let meter: Record<string, unknown> = {};
let sessionState: Record<string, unknown> = {};
let ocppSimulator = true;
let calls: string[] = [];
let createFails = false;

const reading = {
  voltage_l1_v: 127.5, voltage_l2_v: 127.0, voltage_l3_v: 127.0,
  current_l1_a: 100, current_l2_a: 110, current_l3_a: 90,
  active_power_w: 123456, frequency_hz: 60.02, import_energy_kwh: 15234.4,
};
const meterBase = {
  enabled: true, protocol: "MODBUS TCP", origem: "simulado", host: "127.0.0.1", port: 5020, unit_id: 1,
  register_map: [
    { address: 0, name: "voltage_l1_v", unit: "V" },
    { address: 12, name: "active_power_w", unit: "W" },
  ],
  reading, read_at: iso(1000), age_s: 1.4, fresh: true, error: null,
};

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace("http://api.test", "");
      const method = init.method ?? "GET";
      calls.push(`${method} ${path}`);
      const body = init.body ? JSON.parse(init.body as string) : {};
      const auth = (init.headers as Record<string, string>)?.Authorization ?? "";
      const reply = (status: number, payload: unknown) => ({ ok: status < 400, status, statusText: "x", json: async () => payload });

      if (path === "/health")
        return reply(200, {
          status: "ok", version: "0.2.0", env: "development", database: { ok: true, engine: "postgresql" },
          goodwe: { origem: "simulado" }, demo_login: true, ocpp: { enabled: true, simulator: ocppSimulator, connected: 0 },
        });
      if (path === "/stations") return reply(200, [{ id: 1, name: "FIAP Paulista", type: "comercial", chargers: [{ id: 2, code: "CG-002", name: "FIAP #2" }] }]);
      if (path === "/auth/demo-login") return reply(200, { access_token: `tok-${body.role}`, role: body.role, name: "x", user_id: 1 });
      if (path === "/auth/me") {
        const role = auth.replace("Bearer tok-", "");
        return reply(200, { id: role === "operator" ? 2 : 1, name: "Conta Teste", email: `${role}@chargegrid.demo`, role });
      }
      if (path === "/vehicles/me" || path.startsWith("/sessions?")) return reply(200, []);
      // rotas usadas pelo painel de integracao (DashboardBackend), que aparece dentro da tela de Logs
      if (["/billing/invoices", "/events", "/goodwe/plants", "/goodwe/devices", "/goodwe/logs"].some((r) => path.startsWith(r)))
        return reply(200, []);
      if (path === "/goodwe/status") return reply(200, { origem: "simulado", modo: "adaptador_simulado", detalhe: "" });
      if (path.startsWith("/ocpp/messages")) return reply(200, messages);
      if (path === "/ocpp/status") return reply(200, ocppStatus);
      if (path === "/ops/meter") return reply(200, meter);
      if (path === "/sessions" && method === "POST") {
        if (createFails) return reply(409, { detail: "Carregador indisponivel" });
        return reply(200, { id: 11, charger_id: 2, charger_code: "CG-002", charger_name: "FIAP #2", mode: "economico", price_per_kwh_snapshot: 1.4 });
      }
      if (path === "/sessions/11" && method === "GET") return reply(200, sessionState);
      if (path.endsWith("/pay")) return reply(200, { id: 1, method: "pix", status: "aprovado", amount: 1, provider_ref: "SANDBOX-PIX-11" });
      if (path.endsWith("/receipt"))
        return reply(200, { receipt_number: "CG-2026-000011", session_id: 11, energy_kwh: 1.2, price_per_kwh: 1.4, amount: 1.68,
          payment: null, origem: "sandbox", aviso: "", station_name: "FIAP Paulista", charger_code: "CG-002" });
      return reply(200, { id: 11, charger_id: 2, charger_code: "CG-002", charger_name: "FIAP #2", mode: "economico", price_per_kwh_snapshot: 1.4 });
    }),
  );
}

const sessionInput = {
  userName: "João S.", vehicle: "BYD Dolphin", targetPct: 80, departureTime: "18:30", priority: "eco" as const,
};

beforeEach(() => {
  flags.enabled = true;
  calls = [];
  messages = [];
  createFails = false;
  ocppSimulator = true;
  ocppStatus = { enabled: true, auth_required: false, simulator: true, protocol: "OCPP 1.6J", connected: [] };
  meter = { ...meterBase };
  sessionState = {
    id: 11, power_released: false, energy_kwh: 0, current_power_kw: 0, current_pct: 28, price_per_kwh_snapshot: 1.4,
    charger_code: "CG-002", charger_name: "FIAP #2", mode: "economico",
  };
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("funcoes de formatacao do log OCPP", () => {
  it("nomeia as mensagens como o padrao do OCPP (.req / .conf / .err)", () => {
    expect(ocppLabel({ action: "Authorize", message_type: 2 })).toBe("Authorize.req");
    expect(ocppLabel({ action: "Authorize", message_type: 3 })).toBe("Authorize.conf");
    expect(ocppLabel({ action: "Heartbeat", message_type: 4 })).toBe("Heartbeat.err");
    expect(ocppLabel({ action: "", message_type: 3 })).toBe("—.conf");
  });

  it("resume payloads grandes", () => {
    expect(compactPayload({ a: 1 })).toBe('{"a":1}');
    const big = compactPayload({ texto: "x".repeat(300) });
    expect(big.length).toBeLessThanOrEqual(121);
    expect(big.endsWith("…")).toBe(true);
  });
});

describe("Logs OCPP com mensagens reais", () => {
  it("lista os quadros gravados no banco, com direcao, nome e payload", async () => {
    messages = [
      { id: 3, charge_point_id: "CG-002", direction: "out", message_type: 3, action: "StartTransaction", unique_id: "b",
        payload_json: { transactionId: 11, idTagInfo: { status: "Accepted" } }, created_at: iso(2000) },
      { id: 2, charge_point_id: "CG-002", direction: "in", message_type: 2, action: "StartTransaction", unique_id: "b",
        payload_json: { connectorId: 1, idTag: "USR-1", meterStart: 0 }, created_at: iso(3000) },
      { id: 1, charge_point_id: "CG-002", direction: "in", message_type: 2, action: "Authorize", unique_id: "a",
        payload_json: { idTag: "USR-1" }, created_at: iso(200_000) },
    ];
    ocppStatus = { ...ocppStatus, connected: [{ code: "CG-002", connected_at: iso(9000), last_message_at: iso(1000), vendor: "ChargeGrid Sim", model: "Virtual AC 22" }] };
    render(
      <LiveDataProvider>
        <AutoLogin role="operator" />
        <DashboardLogs />
      </LiveDataProvider>,
    );

    const lines = await screen.findAllByTestId("ocpp-line");
    expect(lines).toHaveLength(3);
    // do mais antigo para o mais novo
    expect(within(lines[0]).getByText("Authorize.req")).toBeInTheDocument();
    expect(within(lines[1]).getByText("StartTransaction.req")).toBeInTheDocument();
    expect(within(lines[1]).getByText("CG-002 ▶ CSMS")).toBeInTheDocument();
    expect(within(lines[2]).getByText("StartTransaction.conf")).toBeInTheDocument();
    expect(within(lines[2]).getByText("CSMS ▶ CG-002")).toBeInTheDocument();
    expect(within(lines[2]).getByText(/"transactionId":11/)).toBeInTheDocument();

    expect(screen.getByText("AO VIVO")).toBeInTheDocument();
    expect(screen.getByText("Virtuais (simulados)")).toBeInTheDocument();
    expect(screen.getByText("Carregadores conectados (OCPP 1.6J)")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Mensagens no último minuto").previousElementSibling?.textContent).toBe("2"));
  });

  it("sem mensagens ensina como ligar os carregadores virtuais", async () => {
    render(
      <LiveDataProvider>
        <AutoLogin role="operator" />
        <DashboardLogs />
      </LiveDataProvider>,
    );
    expect(await screen.findByText(/OCPP_SIMULATOR=true/)).toBeInTheDocument();
  });

  it("sem servidor mostra o stream simulado e nao promete numeros falsos", () => {
    flags.enabled = false;
    render(
      <LiveDataProvider>
        <DashboardLogs />
      </LiveDataProvider>,
    );
    expect(screen.getByText("SIMULADO")).toBeInTheDocument();
    expect(screen.getByText(/stream SIMULADO \(sem servidor\)/)).toBeInTheDocument();
    expect(screen.queryByText("99.98%")).not.toBeInTheDocument(); // o "uptime" inventado do design original saiu
    expect(screen.queryByText("8 / 8")).not.toBeInTheDocument();
  });
});

describe("Cartao do medidor MODBUS", () => {
  const renderMeter = () =>
    render(
      <LiveDataProvider>
        <AutoLogin role="operator" />
        <DashboardMeter />
      </LiveDataProvider>,
    );

  it("mostra as leituras, o selo Simulado e o mapa de registradores", async () => {
    renderMeter();
    expect(await screen.findByText("123,5 kW")).toBeInTheDocument();
    expect(screen.getByText("Simulado")).toBeInTheDocument();
    expect(screen.getByText("127,2 V")).toBeInTheDocument(); // media das tres fases
    expect(screen.getByText("100 A")).toBeInTheDocument();
    expect(screen.getByText("60,02 Hz")).toBeInTheDocument();
    expect(screen.getByText("15234 kWh")).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:5020 · unit 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Ver mapa de registradores/));
    expect(screen.getByText("voltage_l1_v")).toBeInTheDocument();
    expect(screen.getByText("12–13")).toBeInTheDocument();
  });

  it("medidor desligado explica o que acontece", async () => {
    meter = { ...meterBase, enabled: false, reading: null, fresh: false, age_s: null };
    renderMeter();
    expect(await screen.findByText(/MODBUS_SIMULATOR=false/)).toBeInTheDocument();
    expect(screen.queryByText(/kW$/)).not.toBeInTheDocument();
  });

  it("sem leitura recente mostra que esta aguardando (e o erro)", async () => {
    meter = { ...meterBase, reading: null, fresh: false, age_s: null, error: "ConnectionException: sem resposta" };
    renderMeter();
    expect(await screen.findByText(/Aguardando leitura do medidor/)).toBeInTheDocument();
    expect(screen.getByText(/ConnectionException/)).toBeInTheDocument();
  });

  it("nao aparece sem servidor nem sem operador logado", () => {
    flags.enabled = false;
    const { container } = render(
      <LiveDataProvider>
        <DashboardMeter />
      </LiveDataProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Modo OCPP no provider (carregador virtual conduz a recarga)", () => {
  const start = async () => {
    render(
      <LiveDataProvider>
        <Probe />
      </LiveDataProvider>,
    );
    await waitFor(() => expect(live.backend.status).toBe("online"));
    await act(async () => {
      await live.loginDemo("driver");
    });
  };
  const charger = () => live.chargers.find((c) => c.id === "CG-002")!;

  it("so pre-autoriza o pagamento: RFID, cabo e leituras vem do carregador", async () => {
    await start();
    expect(live.backend.ocppSimulator).toBe(true);
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.persistedSessionIds["CG-002"]).toBe(11));

    expect(calls).toContain("POST /sessions");
    expect(calls).toContain("POST /sessions/11/confirm-payment");
    expect(calls).not.toContain("POST /sessions/11/authenticate-rfid?approved=true");
    expect(calls).not.toContain("POST /sessions/11/connect-cable");
    expect(live.logs.some((l) => l.msg.includes("virão do carregador via OCPP"))).toBe(true);
  });

  it("segue os numeros medidos pelo carregador (status, kWh, potencia e SoC)", async () => {
    await start();
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.persistedSessionIds["CG-002"]).toBe(11));

    await new Promise((r) => setTimeout(r, 2500)); // passa da espera de 2 s do modo local
    expect(charger().status).toBe("preparing"); // a simulacao local NAO liga sozinha: espera o carregador

    sessionState = { ...sessionState, power_released: true, energy_kwh: 1.2, current_power_kw: 7.4, current_pct: 40 };
    await waitFor(() => expect(charger().status).toBe("charging"), { timeout: 6000 });
    expect(charger()).toMatchObject({ pct: 40, currentPower: 7.4, sessionKwh: 1.2 });
    expect(charger().etaMin).toBe(Math.round(((60 * 0.6) / 7.4) * 60)); // energia restante / potencia
    await waitFor(() => expect(live.activeSessions[0]?.kwh).toBe(1.2), { timeout: 6000 });
  }, 15000);

  it("ao encerrar so paga e para: nao manda leitura de medidor pelo navegador", async () => {
    await start();
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.persistedSessionIds["CG-002"]).toBe(11));
    act(() => live.endSession("CG-002"));
    await waitFor(() => expect(live.completedSessions[0]?.receipt).toBe("CG-2026-000011"));
    expect(calls).toContain("POST /sessions/11/pay");
    expect(calls).toContain("POST /sessions/11/stop");
    expect(calls.filter((c) => c.includes("meter-values"))).toEqual([]);
  });

  it("se o backend recusar a sessao, a recarga segue em simulacao local", async () => {
    createFails = true;
    await start();
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.logs.some((l) => l.msg.includes("sessão NÃO gravada"))).toBe(true));
    await waitFor(() => expect(charger().status).toBe("charging")); // caiu para o modo local
    expect(live.persistedSessionIds["CG-002"]).toBeUndefined();
  });

  it("sem carregador virtual (OCPP_SIMULATOR=false) o app simula RFID e cabo como antes", async () => {
    ocppSimulator = false;
    await start();
    expect(live.backend.ocppSimulator).toBe(false);
    act(() => live.startSession("CG-002", sessionInput));
    await waitFor(() => expect(live.persistedSessionIds["CG-002"]).toBe(11));
    expect(calls).toContain("POST /sessions/11/authenticate-rfid?approved=true");
    expect(calls).toContain("POST /sessions/11/connect-cable");
  });
});
