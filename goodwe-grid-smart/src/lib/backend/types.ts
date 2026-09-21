// Formatos JSON devolvidos pela API FastAPI (backend/app/schemas.py).
// Datas chegam em UTC com sufixo "Z" (ex.: 2026-09-18T17:20:00Z).

export type ApiRole = "driver" | "operator";
export type ApiMode = "rapido" | "economico" | "sustentavel" | "garantido";

export interface ApiToken {
  access_token: string;
  role: ApiRole;
  name: string;
  user_id: number;
}

export interface ApiCharger {
  id: number;
  code: string;
  name: string;
  connector_type: string;
  status: "livre" | "ocupado" | "manutencao";
  max_power_kw: number;
}

export interface ApiStation {
  id: number;
  name: string;
  type: "comercial";
  chargers: ApiCharger[];
}

export interface ApiSession {
  id: number;
  charger_id: number;
  charger_code: string;
  charger_name: string;
  mode: ApiMode;
  vehicle_label: string | null;
  target_pct: number | null;
  departure_time: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  energy_kwh: number;
  current_power_kw: number;
  current_pct: number;
  price_per_kwh_snapshot: number;
  price_source?: string; // "modelo" | "modelo_tempo_real" | "reserva" | "curva"
  price_occupancy?: number | null;
  amount_due: number;
  power_released: boolean;
  lock_released: boolean;
}

export interface ApiPayment {
  id: number;
  method: "pix" | "cartao";
  status: "pendente" | "aprovado" | "recusado";
  amount: number;
  provider_ref: string;
  created_at: string;
}

export interface ApiReceipt {
  receipt_number: string;
  session_id: number;
  station_name: string;
  charger_code: string;
  energy_kwh: number;
  price_per_kwh: number;
  price_source?: string;
  price_occupancy?: number | null;
  price_note?: string;
  amount: number;
  payment: ApiPayment | null;
  origem: string;
  aviso: string;
}

export interface ApiBillingSummary {
  daily_energy_kwh: number;
  daily_revenue: number;
  active_sessions: number;
  available_chargers: number;
  network_capacity_kw: number;
  network_used_kw: number;
}

export interface ApiInvoice {
  receipt_number: string;
  session_id: number;
  user_name: string;
  charger_code: string;
  energy_kwh: number;
  price_per_kwh: number;
  amount: number;
  method: "pix" | "cartao";
  status: string;
  provider_ref: string;
  paid_at: string;
}

export interface ApiEvent {
  id: number;
  session_id: number;
  charger_code: string;
  type: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

export interface ApiHealth {
  status: string;
  version: string;
  env: string;
  database: { ok: boolean; engine: string };
  goodwe: { origem: "simulado" | "real" };
  demo_login?: boolean; // o backend aceita o login de demonstracao?
  payments?: { provider: string; real: boolean };
  ocpp?: { enabled: boolean; simulator: boolean; connected: number };
  modbus?: { simulator: boolean };
}

export interface ApiMe {
  id: number;
  name: string;
  email: string;
  role: ApiRole;
}

export interface ApiVehicle {
  id: number;
  plate: string;
  model: string;
}

export interface ApiGoodWeStatus {
  origem: "simulado" | "real";
  modo: string;
  detalhe: string;
}

export interface ApiGoodWePlant {
  id: string;
  name: string;
  capacity_kw: number;
  status: string;
  origem: "simulado" | "real";
}

export interface ApiGoodWeDevice {
  id: string;
  type: string;
  category: string;
  serial_masked: string;
  status: string;
  origem: "simulado" | "real";
}

export interface ApiIntegrationLog {
  id: number;
  source: string;
  level: string;
  message: string;
  created_at: string;
}

export interface ApiChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ApiAssistantAnswer {
  answer: string;
  category: string;
  /** "ia" = Gemini respondeu; "regras" = assistente por regras do backend. */
  origem: "ia" | "regras";
  modelo: string | null;
}

export interface ApiUserFleet {
  id: number;
  name: string;
  email: string;
  vehicles: { id: number; plate: string; model: string }[];
  total_sessions: number;
  total_spent: number;
}

export interface ApiForecastPoint {
  hour: number;
  occupancy: number;
  ev_load_kw: number;
  total_demand_kw: number;
  price_per_kwh: number;
  band: string;
}

export interface ApiModelInfo {
  version: number;
  source: "csv" | "padrao";
  trained_at: string;
  rows: number;
}

export interface ApiForecast {
  modelo: ApiModelInfo;
  weekday: number;
  weekday_name: string;
  generated_at: string;
  points: ApiForecastPoint[];
  summary: {
    peak_hour: number;
    peak_occupancy: number;
    min_price: number;
    max_price: number;
    avg_price: number;
    saturation_hours: number[];
    saturation_alert: boolean;
    quietest_window_start: number;
    quietest_window_end: number;
  };
  now: {
    occupancy_predicted: number;
    occupancy_live: number;
    occupancy_used: number;
    price_per_kwh: number;
    band: string;
    source: string;
  };
  weekday_index: number[];
  capacity_kw: number;
  base_load_kw: number;
  contracted_kw: number;
  peak_occupancy_ref: number;
  price_min: number;
  price_max: number;
  note: string;
}

export interface ApiModelDetail {
  info: ApiModelInfo;
  weekday_index: number[];
  training: Record<string, unknown>;
  metrics: Record<string, unknown>;
  class_profiles: Record<string, unknown>;
  history: ApiModelInfo[];
}

export interface ApiOcppMessage {
  id: number;
  charge_point_id: string;
  direction: "in" | "out"; // in = carregador -> CSMS, out = CSMS -> carregador
  message_type: number; // 2 = CALL, 3 = CALLRESULT, 4 = CALLERROR
  action: string;
  unique_id: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

export interface ApiOcppStatus {
  enabled: boolean;
  auth_required: boolean;
  simulator: boolean;
  protocol: string;
  connected: { code: string; connected_at: string; last_message_at: string; vendor: string; model: string }[];
}

export interface ApiMeter {
  enabled: boolean;
  protocol: string;
  origem: "simulado";
  host: string;
  port: number;
  unit_id: number;
  register_map: { address: number; name: string; unit: string }[];
  reading: Record<string, number> | null;
  read_at: string | null;
  age_s: number | null;
  fresh: boolean;
  error: string | null;
}
