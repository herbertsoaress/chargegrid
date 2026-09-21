// Modelo de previsao de demanda e preco dinamico -- COPIA LOCAL do backend (services/forecast.py + pricing.py).
// Serve de reserva: sem servidor (ou se a API cair) o app calcula o mesmo preco com os indices embutidos.
// Com o backend online, o app usa a previsao vinda de GET /ai/forecast (modelo treinado no CSV, gravado no banco).
//
//   ocupacao(dia, hora) = min(1, O_ref * (I_dia / I_ref) * g(hora))     g(h) = P1(h)/25,  P1(t) = 5 + 20*sen(pi*t/24)
//   R$/kWh = 1,10 + 0,90 * ocupacao

export const PRICE_MIN = 1.1;
export const PRICE_MAX = 2.0;
export const PEAK_OCCUPANCY_REF = 0.8; // ocupacao de um dia util ao meio-dia (suposicao de cenario)
export const SATURATION_THRESHOLD = 0.9;
export const CONTRACTED_KW = 200;
export const BASE_LOAD_KW = 120;
export const EV_CAPACITY_KW = CONTRACTED_KW - BASE_LOAD_KW; // 80 kW para carros

// segunda..domingo; calibrado com o CSV do grupo (mesmos valores embutidos no backend)
export const DEFAULT_WEEKDAY_INDEX = [1.16, 1.18, 1.22, 1.27, 1.43, 0.38, 0.36];
export const WEEKDAY_NAMES = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];

export type Band = "fora de ponta" | "intermediaria" | "ponta";

export interface ForecastPointView {
  hour: number;
  occupancy: number;
  evLoadKw: number;
  totalDemandKw: number;
  price: number;
  band: Band;
}

export interface ForecastSummaryView {
  peakHour: number;
  peakOccupancy: number;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  saturationHours: number[];
  saturationAlert: boolean;
  quietestStart: number;
  quietestEnd: number;
}

export interface ForecastNowView {
  occupancyPredicted: number;
  occupancyLive: number;
  occupancyUsed: number;
  price: number;
  band: Band;
  source: string; // "modelo" | "modelo_tempo_real" | "reserva" | "local"
}

/** Previsao de hoje, no formato que as telas usam (vem do backend ou do calculo local). */
export interface ForecastView {
  origin: "backend" | "local";
  modelLabel: string;
  weekday: number; // 0 = segunda
  weekdayName: string;
  points: ForecastPointView[];
  summary: ForecastSummaryView;
  now: ForecastNowView;
  weekdayIndex: number[];
  note: string;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export const p1CurveKw = (hour: number) => 5 + 20 * Math.sin((Math.PI * Math.min(Math.max(hour, 0), 24)) / 24);
export const hourlyShape = (hour: number) => p1CurveKw(hour) / 25;

export function weekdayFromDate(date: Date): number {
  return (date.getDay() + 6) % 7; // JS: 0 = domingo -> 0 = segunda
}

export function occupancyAt(index: number[], weekday: number | null, hour: number): number {
  const ref = index.slice(0, 5).reduce((s, v) => s + v, 0) / 5;
  const ratio = weekday === null ? 1 : index[weekday] / ref;
  return clamp01(PEAK_OCCUPANCY_REF * ratio * hourlyShape(hour));
}

export function bandFor(occ: number): Band {
  if (occ < 0.45) return "fora de ponta";
  if (occ < 0.7) return "intermediaria";
  return "ponta";
}

export const priceFromOccupancy = (occ: number) => round2(PRICE_MIN + (PRICE_MAX - PRICE_MIN) * clamp01(occ));

export function hourlyForecast(index: number[], weekday: number | null): ForecastPointView[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const occupancy = occupancyAt(index, weekday, hour + 0.5);
    const evLoadKw = occupancy * EV_CAPACITY_KW;
    return {
      hour,
      occupancy: Math.round(occupancy * 1000) / 1000,
      evLoadKw: Math.round(evLoadKw * 10) / 10,
      totalDemandKw: Math.round((BASE_LOAD_KW + evLoadKw) * 10) / 10,
      price: priceFromOccupancy(occupancy),
      band: bandFor(occupancy),
    };
  });
}

export function summarize(points: ForecastPointView[]): ForecastSummaryView {
  const peak = points.reduce((best, p) => (p.occupancy > best.occupancy ? p : best), points[0]);
  const prices = points.map((p) => p.price);
  const saturationHours = points.filter((p) => p.occupancy >= SATURATION_THRESHOLD).map((p) => p.hour);
  let quietestStart = 0;
  let best = Infinity;
  for (let h = 0; h <= 21; h++) {
    const sum = points[h].occupancy + points[h + 1].occupancy + points[h + 2].occupancy;
    if (sum < best) {
      best = sum;
      quietestStart = h;
    }
  }
  return {
    peakHour: peak.hour,
    peakOccupancy: peak.occupancy,
    minPrice: Math.min(...prices),
    maxPrice: Math.max(...prices),
    avgPrice: round2(prices.reduce((s, v) => s + v, 0) / prices.length),
    saturationHours,
    saturationAlert: saturationHours.length > 0,
    quietestStart,
    quietestEnd: quietestStart + 3,
  };
}

/** Previsao calculada no proprio navegador (reserva). `liveKw` = carga atual dos carros (simulada). */
export function localForecast(now: Date = new Date(), liveKw = 0): ForecastView {
  const weekday = weekdayFromDate(now);
  const points = hourlyForecast(DEFAULT_WEEKDAY_INDEX, weekday);
  const hour = now.getHours() + now.getMinutes() / 60;
  const predicted = occupancyAt(DEFAULT_WEEKDAY_INDEX, weekday, hour);
  const live = clamp01(liveKw / EV_CAPACITY_KW);
  const used = Math.max(predicted, live);
  return {
    origin: "local",
    modelLabel: "Modelo embutido (sem servidor)",
    weekday,
    weekdayName: WEEKDAY_NAMES[weekday],
    points,
    summary: summarize(points),
    now: {
      occupancyPredicted: Math.round(predicted * 1000) / 1000,
      occupancyLive: Math.round(live * 1000) / 1000,
      occupancyUsed: Math.round(used * 1000) / 1000,
      price: priceFromOccupancy(used),
      band: bandFor(used),
      source: "local",
    },
    weekdayIndex: DEFAULT_WEEKDAY_INDEX,
    note:
      "Modelo estatístico calibrado com o histórico do grupo (CSV) e a curva P1 do relatório de Cálculo Integral. " +
      "O nível de ocupação e a capacidade para carros são suposições de cenário. Não é IA generativa.",
  };
}
