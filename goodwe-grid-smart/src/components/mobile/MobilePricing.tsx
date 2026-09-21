import { ArrowLeft, Sun, Moon, Zap } from "lucide-react";
import { useLiveData } from "@/components/dashboard/LiveDataProvider";
import type { Band, ForecastPointView } from "@/lib/pricing";

interface Props {
  onBack: () => void;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}h`;
const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

const BANDS: { band: Band; label: string; icon: typeof Sun; text: string; bar: string }[] = [
  { band: "fora de ponta", label: "Fora de Ponta", icon: Sun, text: "text-green-400", bar: "bg-green-500" },
  { band: "intermediaria", label: "Intermediária", icon: Zap, text: "text-goodwe-orange", bar: "bg-goodwe-orange" },
  { band: "ponta", label: "Ponta", icon: Moon, text: "text-primary", bar: "bg-primary" },
];

/** [0,1,2,20,21] -> "00h–03h, 20h–22h" */
function windows(points: ForecastPointView[]): string {
  const hours = points.map((p) => p.hour);
  const out: string[] = [];
  let start = hours[0];
  let prev = hours[0];
  for (const h of [...hours.slice(1), Infinity]) {
    if (h !== prev + 1) {
      out.push(`${hh(start)}–${hh(prev + 1)}`);
      start = h;
    }
    prev = h;
  }
  return out.join(", ");
}

export function MobilePricing({ onBack }: Props) {
  const { forecast } = useLiveData();
  const { points, now, summary } = forecast;
  const currentHour = new Date().getHours();
  const saving = Math.round((1 - summary.minPrice / summary.maxPrice) * 100);
  const maxPrice = summary.maxPrice;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-foreground" />
        </button>
        <h2 className="text-base font-bold text-foreground">Tarifas Dinâmicas</h2>
      </div>

      <div className="flex-1 px-4 space-y-3 pb-4 overflow-y-auto">
        <div className="glass-card-glow p-4">
          <p className="text-[10px] text-muted-foreground">Preço agora</p>
          <p className="text-3xl font-bold text-foreground tabular-nums">
            {brl(now.price)}
            <span className="text-xs text-muted-foreground font-normal">/kWh</span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Faixa {now.band} · ocupação da rede {Math.round(now.occupancyUsed * 100)}% (prevista {Math.round(now.occupancyPredicted * 100)}%)
          </p>
        </div>

        {BANDS.map(({ band, label, icon: Icon, text }) => {
          const rows = points.filter((p) => p.band === band);
          if (!rows.length) return null;
          const min = Math.min(...rows.map((p) => p.price));
          const max = Math.max(...rows.map((p) => p.price));
          const current = now.band === band;
          return (
            <div key={band} className={`glass-card p-4 ${current ? "border-primary/30" : ""}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${text}`} />
                <h3 className="text-sm font-semibold text-foreground">{label}</h3>
                {current && <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-medium">Atual</span>}
              </div>
              <p className={`text-2xl font-bold ${text} tabular-nums`}>
                {min === max ? brl(min) : `${brl(min)} – ${brl(max)}`}
                <span className="text-xs text-muted-foreground font-normal">/kWh</span>
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">Hoje ({forecast.weekdayName}): {windows(rows)}</p>
            </div>
          );
        })}

        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Preço por hora — hoje</h3>
          <div className="flex items-end gap-[3px] h-20">
            {points.map((p) => {
              const meta = BANDS.find((b) => b.band === p.band)!;
              return (
                <div
                  key={p.hour}
                  title={`${hh(p.hour)} · ${brl(p.price)}`}
                  className={`flex-1 rounded-t-sm ${meta.bar} ${p.hour === currentHour ? "ring-2 ring-white" : "opacity-80"}`}
                  style={{ height: `${Math.max(8, (p.price / maxPrice) * 100)}%` }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
            <span>00h</span>
            <span>06h</span>
            <span>12h</span>
            <span>18h</span>
            <span>24h</span>
          </div>
        </div>

        <div className="glass-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Dica</h3>
          <p className="text-xs text-muted-foreground">
            Carregar entre <span className="text-foreground font-semibold">{hh(summary.quietestStart)} e {hh(summary.quietestEnd)}</span> custa até{" "}
            <span className="text-green-400 font-semibold">{saving}%</span> menos que no horário de pico de hoje.
          </p>
        </div>

        <p className="text-[10px] text-muted-foreground/80 leading-relaxed">
          Preço = R$ 1,10 + R$ 0,90 × ocupação prevista da rede. {forecast.modelLabel}. O valor é travado quando a recarga começa.
        </p>
      </div>
    </div>
  );
}
