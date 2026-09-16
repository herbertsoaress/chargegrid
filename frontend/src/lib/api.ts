import { getToken } from "./auth";
import type {
  AssistantAnswer,
  BalancingSnapshot,
  BillingSummary,
  Charger,
  ChargingSession,
  GoodWeReading,
  GoodWeStatus,
  Payment,
  PaymentMethod,
  PowerCurvePoint,
  PricingPoint,
  Role,
  SessionEvent,
  SessionMode,
  Station,
  StationType,
  TokenResponse,
  UserFleet,
  Vehicle,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, body.detail ?? "Erro inesperado");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  signup: (name: string, email: string, password: string, role: Role) =>
    request<TokenResponse>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password, role }) }),

  login: (email: string, password: string) =>
    request<TokenResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  listStations: () => request<Station[]>("/stations"),

  getStation: (id: number) => request<Station>(`/stations/${id}`),

  getStationTelemetry: (id: number) => request<GoodWeReading>(`/stations/${id}/telemetry`),

  listChargers: () => request<Charger[]>("/chargers"),

  getCharger: (id: number) => request<Charger>(`/chargers/${id}`),

  createSession: (charger_id: number, mode: SessionMode) =>
    request<ChargingSession>("/sessions", { method: "POST", body: JSON.stringify({ charger_id, mode }) }),

  listSessions: () => request<ChargingSession[]>("/sessions"),

  getSession: (id: number) => request<ChargingSession>(`/sessions/${id}`),

  getSessionEvents: (id: number) => request<SessionEvent[]>(`/sessions/${id}/events`),

  confirmPayment: (id: number) => request<ChargingSession>(`/sessions/${id}/confirm-payment`, { method: "POST" }),

  authenticateRfid: (id: number, approved: boolean) =>
    request<ChargingSession>(`/sessions/${id}/authenticate-rfid?approved=${approved}`, { method: "POST" }),

  connectCable: (id: number) => request<ChargingSession>(`/sessions/${id}/connect-cable`, { method: "POST" }),

  maintenanceBypass: (id: number) => request<ChargingSession>(`/sessions/${id}/maintenance-bypass`, { method: "POST" }),

  paySession: (id: number, method: PaymentMethod) =>
    request<Payment>(`/sessions/${id}/pay`, { method: "POST", body: JSON.stringify({ method }) }),

  stopSession: (id: number) => request<ChargingSession>(`/sessions/${id}/stop`, { method: "POST" }),

  billingSummary: () => request<BillingSummary>("/billing/summary"),

  billingPricing: (stationType: StationType) => request<PricingPoint[]>(`/billing/pricing?station_type=${stationType}`),

  billingPowerCurve: (stationType: StationType) =>
    request<PowerCurvePoint[]>(`/billing/power-curve?station_type=${stationType}`),

  billingBalancing: () => request<BalancingSnapshot>("/billing/balancing"),

  goodweStatus: () => request<GoodWeStatus>("/goodwe/status"),

  assistantQuery: (question: string) =>
    request<AssistantAnswer>("/assistant/query", { method: "POST", body: JSON.stringify({ question }) }),

  listUsersAndFleets: () => request<UserFleet[]>("/users"),

  myVehicles: () => request<Vehicle[]>("/vehicles/me"),

  createVehicle: (plate: string, model: string) =>
    request<Vehicle>("/vehicles", { method: "POST", body: JSON.stringify({ plate, model }) }),
};

export { ApiError };
