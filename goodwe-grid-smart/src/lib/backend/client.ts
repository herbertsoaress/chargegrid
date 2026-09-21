import { API_URL } from "./config";
import type {
  ApiAssistantAnswer,
  ApiChatTurn,
  ApiEvent,
  ApiForecast,
  ApiGoodWeDevice,
  ApiGoodWePlant,
  ApiGoodWeStatus,
  ApiHealth,
  ApiIntegrationLog,
  ApiBillingSummary,
  ApiInvoice,
  ApiMe,
  ApiMeter,
  ApiMode,
  ApiModelDetail,
  ApiModelInfo,
  ApiOcppMessage,
  ApiOcppStatus,
  ApiPayment,
  ApiReceipt,
  ApiRole,
  ApiSession,
  ApiStation,
  ApiToken,
  ApiUserFleet,
  ApiVehicle,
} from "./types";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // fetch rejeita quando o servidor esta fora do ar / CORS bloqueou / sem internet
    throw new ApiError(0, "Nao foi possivel falar com o servidor");
  }

  if (response.status === 204) return undefined as T; // sem corpo (ex.: DELETE)
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body?.detail === "string" ? body.detail : response.statusText;
    throw new ApiError(response.status, detail || "Erro inesperado");
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, token: string, body?: unknown) => request<T>(path, { method: "POST", token, body });

export const backend = {
  health: () => request<ApiHealth>("/health"),
  demoLogin: (role: ApiRole) => request<ApiToken>("/auth/demo-login", { method: "POST", body: { role } }),
  login: (email: string, password: string) => request<ApiToken>("/auth/login", { method: "POST", body: { email, password } }),
  signup: (name: string, email: string, password: string) =>
    request<ApiToken>("/auth/signup", { method: "POST", body: { name, email, password } }),
  me: (token: string) => request<ApiMe>("/auth/me", { token }),

  // veiculos do motorista logado
  vehicles: (token: string) => request<ApiVehicle[]>("/vehicles/me", { token }),
  addVehicle: (token: string, body: { plate: string; model: string }) => post<ApiVehicle>("/vehicles", token, body),
  deleteVehicle: (token: string, id: number) => request<void>(`/vehicles/${id}`, { method: "DELETE", token }),
  listStations: () => request<ApiStation[]>("/stations"),

  // jornada da sessao (maquina de estados)
  createSession: (
    token: string,
    body: {
      charger_id: number;
      vehicle_id?: number;
      mode: ApiMode;
      vehicle_label?: string;
      target_pct?: number;
      departure_time?: string;
    },
  ) => post<ApiSession>("/sessions", token, body),
  confirmPayment: (token: string, id: number) => post<ApiSession>(`/sessions/${id}/confirm-payment`, token),
  authenticateRfid: (token: string, id: number) =>
    post<ApiSession>(`/sessions/${id}/authenticate-rfid?approved=true`, token),
  connectCable: (token: string, id: number) => post<ApiSession>(`/sessions/${id}/connect-cable`, token),
  meterValues: (token: string, id: number, body: { energy_kwh: number; power_kw: number; soc_pct?: number }) =>
    post<ApiSession>(`/sessions/${id}/meter-values`, token, body),
  pay: (token: string, id: number, method: "pix" | "cartao") =>
    post<ApiPayment>(`/sessions/${id}/pay`, token, { method }),
  stop: (token: string, id: number) => post<ApiSession>(`/sessions/${id}/stop`, token),
  receipt: (token: string, id: number) => request<ApiReceipt>(`/sessions/${id}/receipt`, { token }),
  completedSessions: (token: string) => request<ApiSession[]>("/sessions?status=completed&limit=50", { token }),

  // assistente (Gemini no backend; cai para regras sem chave/login/limite)
  assistant: (token: string, question: string, history: ApiChatTurn[], screenSnapshot: string) =>
    post<ApiAssistantAnswer>("/assistant/query", token, { question, history, screen_snapshot: screenSnapshot }),

  getSession: (token: string, id: number) => request<ApiSession>(`/sessions/${id}`, { token }),

  // OCPP e MODBUS (operador)
  ocppMessages: (token: string, limit = 80) => request<ApiOcppMessage[]>(`/ocpp/messages?limit=${limit}`, { token }),
  ocppStatus: (token: string) => request<ApiOcppStatus>("/ocpp/status", { token }),
  meter: (token: string) => request<ApiMeter>("/ops/meter", { token }),

  // IA: previsao de demanda e preco dinamico (GET publico; treino so operador)
  forecast: () => request<ApiForecast>("/ai/forecast"),
  modelDetail: (token: string) => request<ApiModelDetail>("/ai/model", { token }),
  retrainModel: (token: string) => post<ApiModelInfo>("/ai/retrain", token),

  // operador
  users: (token: string) => request<ApiUserFleet[]>("/users", { token }),
  billingSummary: (token: string) => request<ApiBillingSummary>("/billing/summary", { token }),
  invoices: (token: string) => request<ApiInvoice[]>("/billing/invoices?limit=20", { token }),
  events: (token: string) => request<ApiEvent[]>("/events?limit=15", { token }),
  goodweStatus: () => request<ApiGoodWeStatus>("/goodwe/status"),
  goodwePlants: (token: string) => request<ApiGoodWePlant[]>("/goodwe/plants", { token }),
  goodweDevices: (token: string) => request<ApiGoodWeDevice[]>("/goodwe/devices", { token }),
  integrationLogs: (token: string) => request<ApiIntegrationLog[]>("/goodwe/logs?limit=10", { token }),
  peakShaving: (token: string) =>
    post<{ logged: boolean; log_id: number }>("/ops/peak-shaving", token, { reduction_pct: 40, duration_s: 30 }),
};

export const tariffsCsvUrl = () => `${API_URL}/ai/tariffs.csv`;
