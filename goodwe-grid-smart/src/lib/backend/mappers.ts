// Funcoes puras que traduzem entre o vocabulario do app (LiveDataProvider) e o da API.
// Ficam separadas para serem testadas sem React (src/test/backend-mappers.test.ts).

import type { ChargeMode, CompletedSession } from "@/components/dashboard/LiveDataProvider";
import type { Band, ForecastView } from "@/lib/pricing";
import type { ApiEvent, ApiForecast, ApiMode, ApiSession } from "./types";

const TO_API: Record<ChargeMode, ApiMode> = {
  rapido: "rapido",
  eco: "economico",
  sustentavel: "sustentavel",
  garantido: "garantido",
};

const FROM_API: Record<ApiMode, ChargeMode> = {
  rapido: "rapido",
  economico: "eco",
  sustentavel: "sustentavel",
  garantido: "garantido",
};

export const toApiMode = (mode: ChargeMode): ApiMode => TO_API[mode];
export const fromApiMode = (mode: ApiMode): ChargeMode => FROM_API[mode] ?? "rapido";

/** A API manda UTC com "Z". Se vier sem, assume UTC (evita o erro de 3h no Brasil). */
export function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
}

/** Frase curta de "de onde veio o preco" para historico/comprovante (espelha price_note do backend). */
export function priceNote(source?: string, occupancy?: number | null): string | undefined {
  if (!source) return undefined;
  const pct = `${Math.round((occupancy ?? 0) * 100)}%`;
  if (source === "modelo") return `Preço do modelo de previsão · ocupação prevista ${pct}`;
  if (source === "modelo_tempo_real") return `Preço do modelo, ajustado pela carga real · ocupação ${pct}`;
  if (source === "reserva") return "Preço pela curva horária de reserva";
  return undefined; // sessoes antigas ("curva"): sem explicacao
}

export function apiForecastToView(api: ApiForecast): ForecastView {
  const label = api.modelo.source === "csv" ? `CSV, ${api.modelo.rows} registros` : "valores embutidos";
  return {
    origin: "backend",
    modelLabel: `Modelo v${api.modelo.version} (${label})`,
    weekday: api.weekday,
    weekdayName: api.weekday_name,
    points: api.points.map((p) => ({
      hour: p.hour,
      occupancy: p.occupancy,
      evLoadKw: p.ev_load_kw,
      totalDemandKw: p.total_demand_kw,
      price: p.price_per_kwh,
      band: p.band as Band,
    })),
    summary: {
      peakHour: api.summary.peak_hour,
      peakOccupancy: api.summary.peak_occupancy,
      minPrice: api.summary.min_price,
      maxPrice: api.summary.max_price,
      avgPrice: api.summary.avg_price,
      saturationHours: api.summary.saturation_hours,
      saturationAlert: api.summary.saturation_alert,
      quietestStart: api.summary.quietest_window_start,
      quietestEnd: api.summary.quietest_window_end,
    },
    now: {
      occupancyPredicted: api.now.occupancy_predicted,
      occupancyLive: api.now.occupancy_live,
      occupancyUsed: api.now.occupancy_used,
      price: api.now.price_per_kwh,
      band: api.now.band as Band,
      source: api.now.source,
    },
    weekdayIndex: api.weekday_index,
    note: api.note,
  };
}

export function apiSessionToCompleted(session: ApiSession): CompletedSession & { sessionId: number } {
  const start = parseUtc(session.started_at).getTime();
  const end = session.ended_at ? parseUtc(session.ended_at).getTime() : start;
  return {
    sessionId: session.id,
    chargerId: session.charger_code,
    chargerName: session.charger_name || session.charger_code,
    userName: "Você",
    vehicle: session.vehicle_label ?? "Veículo",
    priority: fromApiMode(session.mode),
    kwh: session.energy_kwh,
    cost: session.amount_due,
    durationMin: Math.max(0, Math.round((end - start) / 60000)),
    completedAt: (session.ended_at ? parseUtc(session.ended_at) : new Date(start)).toLocaleString("pt-BR"),
    priceNote: priceNote(session.price_source, session.price_occupancy),
  };
}

const EVENT_LABEL: Record<string, string> = {
  session_created: "StartTransaction.req",
  payment_confirmed: "Authorize (pre-autorizacao de pagamento)",
  rfid_authenticated: "Authorize.conf (RFID aprovado)",
  rfid_denied: "Authorize.conf (RFID negado)",
  cable_connected: "StatusNotification: Charging",
  meter_values: "MeterValues",
  maintenance_bypass_enabled: "ChangeAvailability (bypass de manutencao)",
  payment_finalized: "StopTransaction.conf (pagamento liquidado)",
  session_stopped: "StopTransaction.req",
  session_expired: "StopTransaction (expirada por inatividade)",
};

export const describeEvent = (event: ApiEvent): string => EVENT_LABEL[event.type] ?? event.type;

export function formatBrl(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}
