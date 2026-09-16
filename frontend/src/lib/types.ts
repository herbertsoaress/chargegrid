export type Role = "driver" | "operator";
export type StationType = "comercial" | "residencial";
export type ChargerStatus = "livre" | "ocupado" | "manutencao";
export type SessionMode = "rapido" | "economico" | "sustentavel";
export type PaymentMethod = "pix" | "cartao";
export type PaymentStatus = "pendente" | "aprovado" | "recusado";

export interface TokenResponse {
  access_token: string;
  token_type: string;
  role: Role;
  name: string;
  user_id: number;
}

export interface Charger {
  id: number;
  code: string;
  status: ChargerStatus;
  max_power_kw: number;
}

export interface Station {
  id: number;
  name: string;
  type: StationType;
  address: string;
  power_limit_kw: number;
  profile_key: string;
  chargers: Charger[];
}

export interface ChargingSession {
  id: number;
  user_id: number;
  charger_id: number;
  mode: SessionMode;
  payment_confirmed: boolean;
  rfid_ok: boolean;
  cable_connected: boolean;
  maintenance_bypass: boolean;
  payment_finalized: boolean;
  power_released: boolean;
  lock_released: boolean;
  status: string;
  started_at: string;
  ended_at: string | null;
  energy_kwh: number;
  price_per_kwh_snapshot: number;
  amount_due: number;
}

export interface SessionEvent {
  id: number;
  type: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

export interface Payment {
  id: number;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  provider_ref: string;
  created_at: string;
}

export interface BillingSummary {
  daily_energy_kwh: number;
  daily_revenue: number;
  active_sessions: number;
  available_chargers: number;
  network_capacity_kw: number;
  network_used_kw: number;
}

export interface PricingPoint {
  hour: number;
  station_type: StationType;
  price_per_kwh: number;
}

export interface PowerCurvePoint {
  hour: number;
  station_type: StationType;
  power_kw: number;
}

export interface BalancingSnapshot {
  hour: number;
  solar_kw: number;
  battery_soc_percent: number;
  building_load_kw: number;
  ev_load_kw: number;
  total_demand_kw: number;
  grid_import_limit_kw: number;
  supplied_by_solar_kw: number;
  supplied_by_grid_kw: number;
  supplied_by_battery_kw: number;
  within_grid_limit: boolean;
}

export interface GoodWeStatus {
  origem: "simulado" | "real";
  modo: string;
  detalhe: string;
}

export interface GoodWeReading {
  station_id: number;
  origem: "simulado" | "real";
  timestamp: string;
  power_kw: number;
  soc_percent: number | null;
}

export interface AssistantAnswer {
  answer: string;
  category: string;
}

export interface Vehicle {
  id: number;
  plate: string;
  model: string;
}

export interface UserFleet {
  id: number;
  name: string;
  email: string;
  vehicles: Vehicle[];
  total_sessions: number;
}
