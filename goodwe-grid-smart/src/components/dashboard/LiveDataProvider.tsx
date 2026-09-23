import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { toast } from "sonner";
import { backend as api, ApiError } from "@/lib/backend/client";
import { backendEnabled } from "@/lib/backend/config";
import { apiForecastToView, apiSessionToCompleted, formatBrl, priceNote, toApiMode } from "@/lib/backend/mappers";
import type { ApiAssistantAnswer, ApiBillingSummary, ApiChatTurn, ApiLoyalty, ApiRole, ApiSchedule, ApiToken, ApiVehicle } from "@/lib/backend/types";
import { EV_CAPACITY_KW, localForecast, type ForecastView } from "@/lib/pricing";

// A cada quantos ms o "controlador simulado" reporta MeterValues ao backend.
const METER_INTERVAL_MS = 10_000;

/** Usuario logado. O token fica so em memoria (nunca em localStorage): recarregar a pagina pede login de novo. */
export type AuthUser = { token: string; userId: number; name: string; email: string };

export type BackendState = {
  enabled: boolean; // VITE_API_URL definida?
  status: "off" | "connecting" | "online" | "error";
  error?: string;
  operatorToken?: string; // token do operador logado (atalho usado pelos paineis do dashboard)
  engine?: string; // motor do banco informado pelo /health: "postgresql" (Supabase) ou "sqlite" (local)
  demoLogin?: boolean; // o backend aceita "Entrar como demonstracao"? (desligado em producao)
  ocppSimulator?: boolean; // carregadores VIRTUAIS ligados no backend: a recarga segue os numeros que eles mandam por OCPP
  driver?: AuthUser; // motorista logado no app
  operator?: AuthUser; // operador logado no dashboard
};

const errMsg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : "erro desconhecido");

export type ChargerStatus = "available" | "preparing" | "charging" | "finishing" | "faulted";

export type ChargeMode = "eco" | "rapido" | "sustentavel" | "garantido";

export const modeMeta: Record<ChargeMode, { label: string; desc: string; emoji: string; cls: string }> = {
  rapido:      { label: "Rápido",      desc: "Prioridade máxima de potência",      emoji: "⚡", cls: "bg-goodwe-blue/15 text-goodwe-blue border-goodwe-blue/30" },
  eco:         { label: "Econômico",   desc: "Carrega quando a demanda é menor",   emoji: "🌿", cls: "bg-goodwe-green/15 text-goodwe-green border-goodwe-green/30" },
  sustentavel: { label: "Sustentável", desc: "Prioriza energia solar disponível",  emoji: "☀️", cls: "bg-goodwe-orange/15 text-goodwe-orange border-goodwe-orange/30" },
  garantido:   { label: "Garantido",   desc: "Garante % no horário informado",     emoji: "🎯", cls: "bg-primary/15 text-primary border-primary/30" },
};

export interface LiveCharger {
  id: string;
  name: string;
  type: "CCS2 DC" | "Type 2 AC" | "CHAdeMO";
  maxPower: number; // kW
  currentPower: number; // kW
  status: ChargerStatus;
  user: string | null;
  vehicle: string | null;
  pct: number;
  etaMin: number;
  tariff: number; // R$/kWh
  mode?: ChargeMode | null;
  departureTime?: string | null;
  sessionKwh?: number;
  /** Custo ao vivo vindo do backend (energia + tempo + ociosidade), so para sessoes no modo OCPP. */
  liveCost?: number;
  /** Minutos parado com a bateria cheia (ociosidade), so no modo OCPP. */
  liveIdleMin?: number;
  /** Plano do Energy Autopilot (extensao aprovada), so para sessoes com horario de saida no modo OCPP. */
  schedule?: ApiSchedule;
}

export interface ActiveSession {
  chargerId: string;
  userName: string;
  vehicle: string;
  targetPct: number;
  departureTime: string;
  startedAt: number;
  currentPct: number;
  currentPower: number;
  elapsedMin: number;
  estimatedCost: number;
  /** Minutos parado com a bateria cheia (ociosidade). So preenchido no modo OCPP (backend-driven). */
  idleMin: number;
  kwh: number;
  priority: ChargeMode;
  vehicleId?: number; // veiculo cadastrado no perfil (quando logado)
}

export interface CompletedSession {
  chargerId: string;
  chargerName: string;
  userName: string;
  vehicle: string;
  priority: ChargeMode;
  kwh: number;
  cost: number;
  durationMin: number;
  completedAt: string;
  sessionId?: number; // id da sessao no banco (Supabase), quando foi gravada
  receipt?: string; // numero do comprovante sandbox, ex.: CG-2026-000012
  priceNote?: string; // de onde veio o preco (modelo de previsao), quando a sessao foi gravada
}

export interface OcppLog {
  id: number;
  ts: string;
  level: "INFO" | "ACK" | "WARN" | "ERR";
  source: string;
  msg: string;
}

export interface LoadPoint {
  t: string;
  total: number;
  ev: number;
  limit: number;
}

interface LiveData {
  chargers: LiveCharger[];
  logs: OcppLog[];
  load: LoadPoint[];
  activeSessions: ActiveSession[];
  completedSessions: CompletedSession[];
  startSession: (
    chargerId: string,
    session: Omit<ActiveSession, "chargerId" | "startedAt" | "currentPct" | "currentPower" | "elapsedMin" | "estimatedCost" | "idleMin" | "kwh">
  ) => void;
  endSession: (chargerId: string) => void;
  applyPeakShaving: () => void;
  peakShavingActive: boolean;
  /** Estado da conexao com a API FastAPI/Supabase (ou "off" = simulacao local). */
  backend: BackendState;
  /** Historico REAL do motorista, lido do banco (vazio no modo simulado). */
  apiHistory: CompletedSession[];
  /** chargerId -> id da sessao gravada no banco, para as sessoes em andamento. */
  persistedSessionIds: Record<string, number>;
  /**
   * Previsao de demanda e preco de hoje. Com o backend online vem do modelo treinado (GET /ai/forecast);
   * sem servidor e calculada no navegador com os mesmos indices (origin = "local").
   */
  forecast: ForecastView;
  /** Login real (e-mail e senha). Lanca ApiError com a mensagem do servidor se falhar. */
  login: (role: ApiRole, email: string, password: string) => Promise<AuthUser>;
  /** Cria conta de motorista e ja entra. */
  signup: (name: string, email: string, password: string) => Promise<AuthUser>;
  /** "Entrar como demonstracao" (so se backend.demoLogin). */
  loginDemo: (role: ApiRole) => Promise<AuthUser>;
  logout: (role: ApiRole) => void;
  /** Veiculos do motorista logado (vazio se nao logado). */
  vehicles: ApiVehicle[];
  addVehicle: (plate: string, model: string) => Promise<void>;
  removeVehicle: (id: number) => Promise<void>;
  /** Pontuacao do motorista logado (extensao aprovada: so visual, sem desconto). Null se nao logado. */
  loyalty: ApiLoyalty | null;
  /** Retreina o modelo com o CSV (so operador, so com backend). Devolve a mensagem para mostrar ao usuario. */
  retrainForecast: () => Promise<string>;
  /**
   * Pergunta ao assistente do backend (Gemini quando ha chave; senao regras). Devolve null se o
   * backend estiver fora do ar -- quem chama usa a resposta local.
   */
  askAssistant: (
    role: "driver" | "operator",
    question: string,
    history: ApiChatTurn[],
    screenSnapshot: string,
  ) => Promise<ApiAssistantAnswer | null>;
  totals: {
    kwhToday: number;
    revenueToday: number;
    activeSessions: number;
    networkLoadPct: number;
    distributedPower: number;
    networkLimit: number;
    /** De onde vem "energia hoje" e "faturamento hoje": do banco (operador logado) ou contadores simulados. */
    source: "banco" | "simulado";
  };
}

const Ctx = createContext<LiveData | null>(null);

const NETWORK_LIMIT = 200; // kW
const BACKGROUND_AVG_KW = 11; // potencia media por carregador "de fundo" (simulado)
const MAX_BACKGROUND_CHARGING = 6; // sempre sobram 2 carregadores livres para o app

const seedChargers: LiveCharger[] = [ // as tarifas abaixo sao substituidas pelo preco do modelo na inicializacao
  { id: "CG-001", name: "FIAP #1",   type: "Type 2 AC", maxPower: 22, currentPower: 14,  status: "charging",  user: "João S.",   vehicle: "BYD Dolphin",   pct: 68, etaMin: 22, tariff: 2.15, mode: "rapido",      departureTime: "18:30", sessionKwh: 9.8  },
  { id: "CG-002", name: "FIAP #2",   type: "Type 2 AC", maxPower: 22, currentPower: 0,   status: "available", user: null,        vehicle: null,            pct: 0,  etaMin: 0,  tariff: 2.15, mode: null,          departureTime: null,    sessionKwh: 0    },
  { id: "CG-003", name: "FIAP #3",   type: "Type 2 AC", maxPower: 22, currentPower: 11,  status: "charging",  user: "Carlos R.", vehicle: "Volvo XC40",    pct: 42, etaMin: 48, tariff: 1.89, mode: "eco",         departureTime: "19:00", sessionKwh: 6.2  },
  { id: "CG-004", name: "FIAP #4",   type: "Type 2 AC", maxPower: 22, currentPower: 0,   status: "available", user: null,        vehicle: null,            pct: 0,  etaMin: 0,  tariff: 2.35, mode: null,          departureTime: null,    sessionKwh: 0    },
  { id: "CG-005", name: "FIAP #5", type: "Type 2 AC", maxPower: 22, currentPower: 0,   status: "faulted",   user: null,        vehicle: null,            pct: 0,  etaMin: 0,  tariff: 1.89, mode: null,          departureTime: null,    sessionKwh: 0    },
  { id: "CG-006", name: "FIAP #6", type: "Type 2 AC", maxPower: 22, currentPower: 18,  status: "charging",  user: "Maria L.",  vehicle: "GWM Ora 03",    pct: 85, etaMin: 8,  tariff: 2.35, mode: "sustentavel", departureTime: "16:20", sessionKwh: 14.1 },
  { id: "CG-007", name: "FIAP #7", type: "Type 2 AC", maxPower: 22, currentPower: 20,  status: "charging",  user: "Ana P.",    vehicle: "Tesla Model 3", pct: 31, etaMin: 38, tariff: 2.49, mode: "rapido",      departureTime: "18:00", sessionKwh: 8.4  },
  { id: "CG-008", name: "FIAP #8", type: "Type 2 AC", maxPower: 22, currentPower: 0,   status: "available", user: null,        vehicle: null,            pct: 0,  etaMin: 0,  tariff: 1.89, mode: null,          departureTime: null,    sessionKwh: 0    },
];

const initialLogs: OcppLog[] = [
  { id: 1, ts: now(-12), level: "INFO", source: "CG-007", msg: "BootNotification → vendor=GoodWe model=HCharge-150" },
  { id: 2, ts: now(-10), level: "ACK", source: "CSMS", msg: "Accepted heartbeatInterval=30s" },
  { id: 3, ts: now(-8),  level: "INFO", source: "CG-001", msg: "StartTransaction idTag=USR-1042 meterStart=18472" },
  { id: 4, ts: now(-6),  level: "INFO", source: "LB-CORE", msg: "LoadBalancing → redistribute 12kW from CG-004 to CG-007" },
  { id: 5, ts: now(-4),  level: "WARN", source: "LB-CORE", msg: "Demand 192kW approaching limit 200kW (96%)" },
  { id: 6, ts: now(-2),  level: "ACK", source: "CG-006", msg: "StatusNotification status=Charging errorCode=NoError" },
];

function now(offsetSec = 0): string {
  const d = new Date(Date.now() + offsetSec * 1000);
  return d.toLocaleTimeString("pt-BR", { hour12: false });
}

const sources = ["CG-001", "CG-003", "CG-004", "CG-006", "CG-007", "LB-CORE", "CSMS"];
const templates: { level: OcppLog["level"]; msg: (s: string) => string }[] = [
  { level: "INFO", msg: () => `MeterValues energy.active.import.register=${(Math.random()*40000+5000).toFixed(0)}Wh` },
  { level: "ACK",  msg: () => `Heartbeat → currentTime=${new Date().toISOString()}` },
  { level: "INFO", msg: () => `LoadBalancing → setChargingProfile limit=${(Math.random()*60+20).toFixed(1)}kW` },
  { level: "INFO", msg: (s) => `StatusNotification status=${["Charging","Preparing","SuspendedEV"][Math.floor(Math.random()*3)]} on ${s}` },
  { level: "WARN", msg: () => `Peak shaving triggered → reducing fleet output by 12%` },
  { level: "INFO", msg: () => `StopTransaction reason=Local meterStop=${(Math.random()*40000+10000).toFixed(0)}Wh` },
  { level: "ACK",  msg: () => `Authorize idTag=USR-${Math.floor(Math.random()*9999)} → Accepted` },
];

export function LiveDataProvider({ children }: { children: ReactNode }) {
  const existing = useContext(Ctx);
  if (existing) return <>{children}</>;
  return <LiveDataRoot>{children}</LiveDataRoot>;
}

function LiveDataRoot({ children }: { children: ReactNode }) {
  const [forecast, setForecast] = useState<ForecastView>(() => localForecast());
  const [chargers, setChargers] = useState<LiveCharger[]>(() => {
    const price = localForecast().now.price; // mesmo preco do modelo para todos (local unico)
    return seedChargers.map((c) => ({ ...c, tariff: price }));
  });
  const [logs, setLogs] = useState<OcppLog[]>(initialLogs);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [completedSessions, setCompletedSessions] = useState<CompletedSession[]>([]);
  const [peakShavingActive, setPeakShavingActive] = useState(false);
  const shavingRef = useRef(false);
  const [load, setLoad] = useState<LoadPoint[]>(() => {
    const arr: LoadPoint[] = [];
    for (let i = 15; i >= 0; i--) {
      const buildingBase = 120; // consumo fixo do prédio
      const evLoad = 40 + Math.sin(i / 3) * 15 + Math.random() * 10; // EVs: 30-65 kW
      const total = Math.min(195, buildingBase + evLoad); // nunca passa de 195 kW
      arr.push({
        t: new Date(Date.now() - i * 60_000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        total: Math.round(total),
        ev: Math.round(evLoad),
        limit: NETWORK_LIMIT,
      });
    }
    return arr;
  });
  const [billing, setBilling] = useState<ApiBillingSummary | null>(null);
  const [revenueToday, setRevenueToday] = useState(2681);
  const [kwhToday, setKwhToday] = useState(1247);
  const logId = useRef(initialLogs.length);

  const pushLog = (level: OcppLog["level"], source: string, msg: string) => {
    logId.current += 1;
    const entry: OcppLog = { id: logId.current, ts: new Date().toLocaleTimeString("pt-BR", { hour12: false }), level, source, msg };
    setLogs((prev) => [...prev.slice(-49), entry]);
  };

  // ---------------------------------------------------------------------------
  // Persistencia no backend (FastAPI + Supabase). Tudo abaixo so roda se VITE_API_URL
  // estiver definida; se a API cair, o app segue em simulacao local (fallback).
  // ---------------------------------------------------------------------------
  const [backendState, setBackendState] = useState<BackendState>({
    enabled: backendEnabled,
    status: backendEnabled ? "connecting" : "off",
  });
  const [apiHistory, setApiHistory] = useState<CompletedSession[]>([]);
  const [persistedSessionIds, setPersistedSessionIds] = useState<Record<string, number>>({});
  const [vehicles, setVehicles] = useState<ApiVehicle[]>([]);
  const [loyalty, setLoyalty] = useState<ApiLoyalty | null>(null);
  // idByCode: codigo do carregador (CG-001) -> id no banco. tokens: sessao dos usuarios logados (so em memoria).
  const conn = useRef<{ idByCode: Record<string, number> } | null>(null);
  const tokens = useRef<{ driver?: string; operator?: string }>({});
  const sessionByCharger = useRef<Record<string, number>>({});
  // Modo OCPP: o carregador virtual (backend) conduz a recarga (RFID, cabo, medidor). O navegador so acompanha.
  const ocppMode = useRef(false);
  const backendDriven = useRef<Set<string>>(new Set()); // carregadores cuja recarga vem do backend
  const latest = useRef({ activeSessions, chargers });
  latest.current = { activeSessions, chargers };

  const refreshHistory = async () => {
    const token = tokens.current.driver;
    if (!token) return;
    try {
      setApiHistory((await api.completedSessions(token)).map(apiSessionToCompleted));
    } catch {
      /* historico e "nice to have": falha silenciosa */
    }
  };

  const refreshLoyalty = async () => {
    const token = tokens.current.driver;
    if (!token) return;
    try {
      setLoyalty(await api.loyalty(token));
    } catch {
      /* pontuacao e "nice to have": falha silenciosa */
    }
  };

  const refreshVehicles = async () => {
    const token = tokens.current.driver;
    if (!token) return;
    try {
      setVehicles(await api.vehicles(token));
    } catch {
      /* lista de veiculos e "nice to have": falha silenciosa */
    }
  };

  useEffect(() => {
    if (!backendEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const [stations, health] = await Promise.all([api.listStations(), api.health()]);
        if (cancelled) return;
        const idByCode: Record<string, number> = {};
        stations.forEach((s) => s.chargers.forEach((c) => (idByCode[c.code] = c.id)));
        conn.current = { idByCode };
        setBackendState((prev) => ({
          ...prev,
          enabled: true,
          status: "online",
          engine: health.database.engine,
          demoLogin: health.demo_login ?? false,
          ocppSimulator: health.ocpp?.simulator ?? false,
        }));
        ocppMode.current = health.ocpp?.simulator ?? false;
        pushLog("ACK", "CSMS", `[API] conectada (banco: ${health.database.engine}) — entre com uma conta para gravar sessões e comprovantes`);
      } catch (e) {
        if (cancelled) return;
        setBackendState((prev) => ({ ...prev, enabled: true, status: "error", error: errMsg(e) }));
        pushLog("WARN", "CSMS", `[API] indisponível (${errMsg(e)}) — seguindo em simulação local`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Energia e faturamento de hoje: com operador logado vem do banco (GET /billing/summary), a cada 8 s.
  useEffect(() => {
    const token = backendState.operatorToken;
    if (backendState.status !== "online" || !token) {
      setBilling(null);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const summary = await api.billingSummary(token);
        if (!cancelled) setBilling(summary);
      } catch {
        if (!cancelled) setBilling(null); // sem o banco, volta aos contadores simulados (e diz que sao)
      }
    };
    void refresh();
    const timer = setInterval(refresh, 8_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [backendState.status, backendState.operatorToken]);

  // Previsao e preco: com backend busca GET /ai/forecast (publico) a cada minuto; sem servidor (ou se a
  // API cair) recalcula no navegador com os mesmos indices (lib/pricing.ts).
  const liveKwRef = useRef(0);
  const forecastRef = useRef(forecast);
  forecastRef.current = forecast;
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (backendEnabled) {
        try {
          const view = apiForecastToView(await api.forecast());
          if (!cancelled) setForecast(view);
          return;
        } catch {
          /* API fora do ar: usa o calculo local abaixo */
        }
      }
      if (!cancelled) setForecast(localForecast(new Date(), liveKwRef.current));
    };
    void refresh();
    const timer = setInterval(refresh, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // A tarifa dos carregadores acompanha o preco atual do modelo; a das sessoes em andamento fica travada.
  useEffect(() => {
    const price = forecast.now.price;
    setChargers((prev) =>
      prev.map((c) => (c.status === "charging" || c.status === "preparing" || c.tariff === price ? c : { ...c, tariff: price })),
    );
  }, [forecast.now.price]);

  // Modo OCPP: acompanha a sessao gravada (energia, potencia e SoC medidos pelo carregador virtual via OCPP).
  useEffect(() => {
    if (!backendEnabled) return;
    const timer = setInterval(async () => {
      const token = tokens.current.driver;
      if (!token || !ocppMode.current) return;
      for (const chargerId of Array.from(backendDriven.current)) {
        const sessionId = sessionByCharger.current[chargerId];
        if (!sessionId) continue;
        try {
          const s = await api.getSession(token, sessionId);
          if (!backendDriven.current.has(chargerId)) continue; // encerrada enquanto esperavamos
          const kwhLeft = ((100 - s.current_pct) / 100) * 60; // bateria de 60 kWh (a mesma do simulador)
          // Energy Autopilot (extensao aprovada): so ha plano para modos com horario de saida.
          const schedule = s.mode !== "rapido" ? await api.schedule(token, sessionId).catch(() => undefined) : undefined;
          setChargers((prev) =>
            prev.map((c) =>
              c.id !== chargerId
                ? c
                : {
                    ...c,
                    status: s.power_released ? "charging" : "preparing",
                    pct: s.current_pct,
                    currentPower: s.current_power_kw,
                    sessionKwh: s.energy_kwh,
                    etaMin: s.current_power_kw > 0 ? Math.round((kwhLeft / s.current_power_kw) * 60) : 0,
                    liveCost: s.amount_estimate,
                    liveIdleMin: s.minutes_idle,
                    schedule: schedule ?? c.schedule,
                  },
            ),
          );
        } catch {
          /* falha momentanea: tenta de novo no proximo ciclo */
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // "Controlador simulado": reporta a telemetria das sessoes gravadas (equivale ao MeterValues do OCPP).
  useEffect(() => {
    if (!backendEnabled) return;
    const timer = setInterval(() => {
      const token = tokens.current.driver;
      if (!token || ocppMode.current) return; // no modo OCPP quem manda as leituras e o carregador virtual
      for (const s of latest.current.activeSessions) {
        const sid = sessionByCharger.current[s.chargerId];
        if (!sid) continue;
        api
          .meterValues(token, sid, {
            energy_kwh: Math.round(s.kwh * 1000) / 1000,
            power_kw: Math.round(s.currentPower * 100) / 100,
            soc_pct: Math.min(100, Math.max(0, Math.round(s.currentPct * 10) / 10)),
          })
          .catch(() => undefined);
      }
    }, METER_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const persistStart = async (
    chargerId: string,
    session: Parameters<LiveData["startSession"]>[1],
  ) => {
    const c = conn.current;
    const token = tokens.current.driver;
    if (!c) return;
    if (!token) {
      pushLog("INFO", chargerId, "[API] sem login de motorista: recarga apenas em simulação local (não gravada)");
      return;
    }
    const backendChargerId = c.idByCode[chargerId];
    try {
      if (!backendChargerId) throw new Error(`carregador ${chargerId} não existe no banco`);
      const created = await api.createSession(token, {
        charger_id: backendChargerId,
        vehicle_id: session.vehicleId,
        mode: toApiMode(session.priority),
        vehicle_label: session.vehicle,
        target_pct: session.targetPct,
        departure_time: session.departureTime,
      });
      // Jornada da maquina de estados: A (pagamento) -> B (RFID) -> C (cabo) => S=1
      await api.confirmPayment(token, created.id);
      if (!ocppMode.current) {
        // Sem carregador virtual: o proprio app simula RFID e cabo (A -> B -> C => S=1)
        await api.authenticateRfid(token, created.id);
        await api.connectCable(token, created.id);
      }
      sessionByCharger.current[chargerId] = created.id;
      setPersistedSessionIds((prev) => ({ ...prev, [chargerId]: created.id }));
      // a tarifa passa a ser a do backend (dinamica por horario), a mesma que sera cobrada
      setChargers((prev) => prev.map((ch) => (ch.id === chargerId ? { ...ch, tariff: created.price_per_kwh_snapshot } : ch)));
      pushLog(
        "ACK",
        chargerId,
        ocppMode.current
          ? `[API] Sessão #${created.id} gravada · A=1 (pagamento) — RFID e cabo virão do carregador via OCPP`
          : `[API] Sessão #${created.id} gravada · A=1 B=1 C=1 → energia liberada`,
      );
    } catch (e) {
      if (backendDriven.current.delete(chargerId)) {
        // o backend nao aceitou: volta para a simulacao local desta recarga
        setChargers((prev) => prev.map((ch) => (ch.id === chargerId && ch.status === "preparing" ? { ...ch, status: "charging" } : ch)));
      }
      pushLog("WARN", chargerId, `[API] sessão NÃO gravada: ${errMsg(e)}`);
      toast.warning("Sessão não foi salva no servidor", {
        description: `${errMsg(e)}. A recarga segue apenas em simulação local.`,
      });
    }
  };

  const persistEnd = async (
    chargerId: string,
    sessionId: number,
    final: { kwh: number; currentPower: number; currentPct: number },
  ) => {
    const token = tokens.current.driver;
    if (!token) return;
    delete sessionByCharger.current[chargerId];
    setPersistedSessionIds((prev) => {
      const next = { ...prev };
      delete next[chargerId];
      return next;
    });
    try {
      if (!ocppMode.current) {
        await api
          .meterValues(token, sessionId, {
            energy_kwh: Math.round(final.kwh * 1000) / 1000,
            power_kw: Math.round(final.currentPower * 100) / 100,
            soc_pct: Math.min(100, Math.max(0, Math.round(final.currentPct * 10) / 10)),
          })
          .catch(() => undefined); // se a ultima leitura falhar, vale a anterior
      } // no modo OCPP a energia final e a ultima leitura do medidor do carregador
      await api.pay(token, sessionId, "pix"); // pagamento SANDBOX (aprovacao simulada)
      await api.stop(token, sessionId);
      const receipt = await api.receipt(token, sessionId);
      setCompletedSessions((prev) =>
        prev.map((s) =>
          s.sessionId === sessionId
            ? {
                ...s,
                kwh: receipt.energy_kwh,
                cost: receipt.amount,
                receipt: receipt.receipt_number,
                priceNote: priceNote(receipt.price_source, receipt.price_occupancy),
              }
            : s,
        ),
      );
      pushLog("ACK", chargerId, `[API] Comprovante ${receipt.receipt_number} · ${receipt.energy_kwh.toFixed(2)} kWh · ${formatBrl(receipt.amount)}`);
      toast.success(`Comprovante ${receipt.receipt_number}`, {
        description: `${formatBrl(receipt.amount)} · pagamento sandbox (sem valor fiscal)`,
      });
      refreshHistory();
      void refreshLoyalty(); // a sessao que acabou de encerrar pode ter batido a meta da semana
    } catch (e) {
      pushLog("WARN", chargerId, `[API] encerramento NÃO gravado: ${errMsg(e)}`);
      toast.warning("Não foi possível fechar a sessão no servidor", { description: errMsg(e) });
    }
  };

  const startSession: LiveData["startSession"] = (chargerId, session) => {
    const driven = ocppMode.current && !!tokens.current.driver && !!conn.current;
    if (driven) backendDriven.current.add(chargerId);
    void persistStart(chargerId, session);
    setChargers((prev) =>
      prev.map((c) =>
        c.id === chargerId
          ? {
              ...c,
              status: "preparing",
              user: session.userName,
              vehicle: session.vehicle,
              mode: session.priority,
              departureTime: session.departureTime,
              pct: 5,
              sessionKwh: 0,
              currentPower: Math.min(22, c.maxPower * (session.priority === "rapido" ? 0.85 : session.priority === "eco" ? 0.4 : 0.6)),
              etaMin: 45,
            }
          : c
      )
    );
    pushLog("INFO", chargerId, `StartTransaction idTag=APP-MOBILE meterStart=0 priority=${session.priority}`);
    setActiveSessions((prev) => [
      ...prev.filter((s) => s.chargerId !== chargerId),
      { ...session, chargerId, startedAt: Date.now(), currentPct: 5, currentPower: 0, elapsedMin: 0, estimatedCost: 0, idleMin: 0, kwh: 0 },
    ]);
    if (driven) return; // o status "Charging" vem do carregador (StatusNotification) via backend
    setTimeout(() => {
      setChargers((prev) => prev.map((c) => (c.id === chargerId ? { ...c, status: "charging" } : c)));
      pushLog("ACK", chargerId, "StatusNotification status=Charging errorCode=NoError");
    }, 2000);
  };

  const endSession = (chargerId: string) => {
    backendDriven.current.delete(chargerId); // daqui em diante a simulacao local cuida do "finalizando"
    const session = activeSessions.find((s) => s.chargerId === chargerId);
    const charger = chargers.find((c) => c.id === chargerId);
    const persistedId = sessionByCharger.current[chargerId];
    if (session && charger) {
      const completed: CompletedSession = {
        chargerId,
        chargerName: charger.name,
        userName: session.userName,
        vehicle: session.vehicle,
        priority: session.priority,
        kwh: parseFloat(session.kwh.toFixed(2)),
        cost: parseFloat(session.estimatedCost.toFixed(2)),
        durationMin: session.elapsedMin,
        completedAt: new Date().toLocaleString("pt-BR"),
        sessionId: persistedId,
      };
      setCompletedSessions((prev) => [completed, ...prev]);
    }
    setChargers((prev) => prev.map((c) => (c.id === chargerId ? { ...c, status: "finishing", currentPower: 0, etaMin: 0 } : c)));
    pushLog("INFO", chargerId, "StopTransaction reason=Remote idTag=APP-MOBILE");
    setActiveSessions((prev) => prev.filter((s) => s.chargerId !== chargerId));
    if (session && persistedId) {
      void persistEnd(chargerId, persistedId, {
        kwh: session.kwh,
        currentPower: session.currentPower,
        currentPct: session.currentPct,
      });
    }
  };

  // ---- Autenticacao real (Parte 3). Cada papel tem a sua sessao: o app usa "driver", o dashboard "operator".
  const acceptToken = async (role: ApiRole, response: ApiToken): Promise<AuthUser> => {
    const me = await api.me(response.access_token); // confere o papel e traz o e-mail
    if (me.role !== role) {
      throw new ApiError(
        403,
        role === "operator" ? "Esta conta não tem acesso de operador." : "Esta conta é de operador: use o painel do Dashboard.",
      );
    }
    const user: AuthUser = { token: response.access_token, userId: me.id, name: me.name, email: me.email };
    tokens.current[role] = user.token;
    setBackendState((prev) => ({
      ...prev,
      [role]: user,
      ...(role === "operator" ? { operatorToken: user.token } : {}),
    }));
    if (role === "driver") {
      void refreshHistory();
      void refreshVehicles();
      void refreshLoyalty();
    }
    pushLog("ACK", "CSMS", `[API] ${role === "operator" ? "operador" : "motorista"} ${user.name} autenticado`);
    return user;
  };

  const login: LiveData["login"] = async (role, email, password) => acceptToken(role, await api.login(email.trim(), password));
  const signup: LiveData["signup"] = async (name, email, password) =>
    acceptToken("driver", await api.signup(name.trim(), email.trim(), password));
  const loginDemo: LiveData["loginDemo"] = async (role) => acceptToken(role, await api.demoLogin(role));

  const logout: LiveData["logout"] = (role) => {
    delete tokens.current[role];
    setBackendState((prev) => {
      const next = { ...prev };
      delete next[role];
      if (role === "operator") delete next.operatorToken;
      return next;
    });
    if (role === "driver") {
      setApiHistory([]);
      setVehicles([]);
      setLoyalty(null);
    }
  };

  const addVehicle: LiveData["addVehicle"] = async (plate, model) => {
    const token = tokens.current.driver;
    if (!token) throw new Error("Entre para cadastrar um veículo");
    await api.addVehicle(token, { plate, model });
    await refreshVehicles();
  };

  const removeVehicle: LiveData["removeVehicle"] = async (id) => {
    const token = tokens.current.driver;
    if (!token) throw new Error("Entre para remover um veículo");
    await api.deleteVehicle(token, id);
    await refreshVehicles();
  };

  const retrainForecast = async () => {
    const token = tokens.current.operator;
    if (!token) throw new Error("Entre como operador para retreinar o modelo");
    const info = await api.retrainModel(token);
    setForecast(apiForecastToView(await api.forecast()));
    pushLog("ACK", "AI", `[API] Modelo de previsão v${info.version} treinado (${info.rows} registros)`);
    return `Modelo v${info.version} treinado com ${info.rows} registros.`;
  };

  const askAssistant: LiveData["askAssistant"] = async (role, question, history, screenSnapshot) => {
    const token = role === "driver" ? tokens.current.driver : tokens.current.operator;
    if (!token) return null; // sem login: o assistente local responde
    try {
      return await api.assistant(token, question, history, screenSnapshot);
    } catch {
      return null; // API fora do ar / limite: o assistente local responde
    }
  };

  const applyPeakShaving = () => {
    if (shavingRef.current) return;
    shavingRef.current = true;
    setPeakShavingActive(true);
    setChargers((prev) => prev.map((c) => (c.mode === "eco" && c.status === "charging" ? { ...c, currentPower: c.maxPower * 0.6 } : c)));
    pushLog("WARN", "LB-CORE", "PeakShaving → setChargingProfile 60% on mode=eco chargers (30s)");
    if (tokens.current.operator) {
      api
        .peakShaving(tokens.current.operator)
        .then((r) => pushLog("ACK", "LB-CORE", `[API] PeakShaving registrado na auditoria (log #${r.log_id})`))
        .catch((e) => pushLog("WARN", "LB-CORE", `[API] auditoria do PeakShaving falhou: ${errMsg(e)}`));
    }
    setTimeout(() => {
      shavingRef.current = false;
      setPeakShavingActive(false);
      pushLog("ACK", "LB-CORE", "PeakShaving window expired → restoring nominal profiles");
    }, 30000);
  };

  useEffect(() => {
    const tick = setInterval(() => {
      let snapshot: LiveCharger[] = [];
      setChargers((prev) => {
        // Os carregadores "de fundo" (os que nao sao do app nem do carregador virtual) seguem a ocupacao
        // que o MODELO preve para agora: quantos carregam e quanta potencia dividem. Assim o ponto azul
        // do grafico de IA fica perto da linha prevista. Continua sendo simulacao (e diz isso na tela).
        const appIds = new Set(latest.current.activeSessions.map((s) => s.chargerId));
        const isBackground = (c: LiveCharger) => !backendDriven.current.has(c.id) && !appIds.has(c.id);
        const evTargetKw = forecastRef.current.now.occupancyPredicted * EV_CAPACITY_KW;
        const foreignKw = prev.filter((c) => !isBackground(c)).reduce((s, c) => s + c.currentPower, 0);
        const backgroundKw = Math.max(0, evTargetKw - foreignKw);
        const wantedCharging = Math.min(MAX_BACKGROUND_CHARGING, Math.ceil(backgroundKw / BACKGROUND_AVG_KW));
        const backgroundActive = prev.filter((c) => isBackground(c) && (c.status === "charging" || c.status === "preparing")).length;
        const backgroundCharging = prev.filter((c) => isBackground(c) && c.status === "charging").length;
        const sharedKw = backgroundCharging ? Math.min(22, Math.max(3, backgroundKw / backgroundCharging)) : 0;
        let started = 0; // quantos carregadores "comecam" neste tick (evita passar do alvo de uma vez)
        return (snapshot = prev.map((c) => {
          if (backendDriven.current.has(c.id)) return c; // valores vem do carregador virtual (efeito abaixo)
          if (c.status === "charging") {
            if (isBackground(c) && backgroundCharging > wantedCharging && Math.random() < 0.15) {
              // ocupacao prevista menor que a atual: este carregador encerra antes
              return { ...c, currentPower: 0, status: "finishing" as ChargerStatus, etaMin: 0 };
            }
            const newPct = Math.min(100, c.pct + Math.random() * 1.2);
            const drift = (Math.random() - 0.5) * 4;
            const cap = Math.min(22, shavingRef.current && c.mode === "eco" ? c.maxPower * 0.6 : c.maxPower);
            const base = isBackground(c) ? c.currentPower + (sharedKw - c.currentPower) * 0.35 + drift * 0.4 : c.currentPower + drift;
            const newPower = Math.max(1, Math.min(cap, base));
            const newEta = Math.max(0, Math.round((100 - newPct) * 0.6));
            const kwh = (c.sessionKwh ?? 0) + (newPower * 2) / 3600;
            if (newPct >= 100) return { ...c, pct: 100, currentPower: 0, status: "finishing" as ChargerStatus, etaMin: 0, sessionKwh: kwh };
            return { ...c, pct: newPct, currentPower: newPower, etaMin: newEta, sessionKwh: kwh };
          }
          if (c.status === "preparing" && Math.random() < 0.35) {
            return { ...c, status: "charging" as ChargerStatus, pct: Math.max(6, c.pct) };
          }
          if (c.status === "finishing" && Math.random() < 0.3) {
            return { ...c, status: "available" as ChargerStatus, user: null, vehicle: null, pct: 0, currentPower: 0, mode: null, departureTime: null, sessionKwh: 0 };
          }
          if (c.status === "available" && backgroundActive + started < wantedCharging && Math.random() < 0.3) {
            const otherAvailable = prev.filter((x) => x.id !== c.id && x.status === "available").length;
            if (otherAvailable < 2) return c;
            started += 1;
            const names = ["Lucas T.", "Bruno F.", "Camila V.", "Renata B."];
            const cars = ["Renault Kwid E-Tech", "Fiat 500e", "Peugeot e-208", "Nissan Leaf"];
            const modes: ChargeMode[] = ["eco", "rapido", "sustentavel", "garantido"];
            return {
              ...c,
              status: "preparing" as ChargerStatus,
              user: names[Math.floor(Math.random() * names.length)],
              vehicle: cars[Math.floor(Math.random() * cars.length)],
              mode: modes[Math.floor(Math.random() * modes.length)],
              departureTime: ["17:30", "18:00", "18:30", "19:15"][Math.floor(Math.random() * 4)],
              currentPower: Math.min(22, c.maxPower * 0.4),
              pct: 2,
              etaMin: 60,
              sessionKwh: 0,
            };
          }
          return c;
        }));
      });

      setActiveSessions((prev) =>
        prev.map((s) => {
          const c = snapshot.find((x) => x.id === s.chargerId);
          if (!c) return s;
          const kwh = c.sessionKwh ?? s.kwh;
          return {
            ...s,
            currentPct: c.pct,
            currentPower: c.currentPower,
            elapsedMin: Math.max(0, Math.round((Date.now() - s.startedAt) / 60000)),
            kwh,
            // No modo OCPP, o backend ja soma energia + tempo de uso + ociosidade (com o teto por
            // kWh); sem isso, cai na conta local simples (so energia x tarifa).
            estimatedCost: c.liveCost ?? kwh * c.tariff,
            idleMin: c.liveIdleMin ?? 0,
          };
        })
      );

      setLoad((prev) => {
        const buildingBase = 120;
        const evContrib = snapshot.reduce((s, c) => s + c.currentPower, 0); // soma real dos EVs
        const evCapped = Math.min(evContrib, NETWORK_LIMIT - buildingBase - 5); // EVs nunca deixam passar do limite
        const total = Math.round(buildingBase + evCapped);
        const point: LoadPoint = {
          t: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          total,
          ev: Math.round(evCapped),
          limit: NETWORK_LIMIT,
        };
        return [...prev.slice(-19), point];
      });

      setRevenueToday((r) => r + Math.random() * 4 + 1);
      setKwhToday((k) => k + Math.random() * 2 + 0.5);

      if (Math.random() < 0.7) {
        const tpl = templates[Math.floor(Math.random() * templates.length)];
        const src = sources[Math.floor(Math.random() * sources.length)];
        logId.current += 1;
        const newLog: OcppLog = {
          id: logId.current,
          ts: new Date().toLocaleTimeString("pt-BR", { hour12: false }),
          level: tpl.level,
          source: src,
          msg: tpl.msg(src),
        };
        setLogs((prev) => [...prev.slice(-49), newLog]);
      }
    }, 2000);
    return () => clearInterval(tick);
  }, []);

  const distributedPower = chargers.reduce((s, c) => s + c.currentPower, 0);
  liveKwRef.current = Math.min(distributedPower, EV_CAPACITY_KW * 2); // carga atual dos carros (simulada), para o calculo local
  const activeCount = chargers.filter((c) => c.status === "charging" || c.status === "preparing").length;

  const value: LiveData = {
    chargers,
    logs,
    load,
    activeSessions,
    completedSessions,
    startSession,
    endSession,
    applyPeakShaving,
    peakShavingActive,
    backend: backendState,
    apiHistory,
    persistedSessionIds,
    forecast,
    login,
    signup,
    loginDemo,
    logout,
    vehicles,
    addVehicle,
    removeVehicle,
    loyalty,
    retrainForecast,
    askAssistant,
    totals: {
      kwhToday: billing ? Math.round(billing.daily_energy_kwh * 10) / 10 : Math.round(kwhToday),
      revenueToday: billing ? Math.round(billing.daily_revenue * 100) / 100 : Math.round(revenueToday),
      source: billing ? "banco" : "simulado",
      activeSessions: activeCount,
      networkLoadPct: Math.min(100, (distributedPower / NETWORK_LIMIT) * 100),
      distributedPower: Math.round(distributedPower * 10) / 10,
      networkLimit: NETWORK_LIMIT,
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLiveData() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLiveData must be used within LiveDataProvider");
  return v;
}

export const statusMeta: Record<ChargerStatus, { label: string; cls: string; dot: string }> = {
  available: { label: "Disponível", cls: "bg-goodwe-green/15 text-goodwe-green border-goodwe-green/30", dot: "text-goodwe-green" },
  preparing: { label: "Preparando", cls: "bg-goodwe-orange/15 text-goodwe-orange border-goodwe-orange/30", dot: "text-goodwe-orange" },
  charging:  { label: "Carregando", cls: "bg-goodwe-blue/15 text-goodwe-blue border-goodwe-blue/30", dot: "text-goodwe-blue" },
  finishing: { label: "Concluído",  cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", dot: "text-emerald-400" },
  faulted:   { label: "Falha",      cls: "bg-primary/15 text-primary border-primary/30", dot: "text-primary" },
};
