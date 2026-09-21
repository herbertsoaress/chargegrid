// Mapa real com Leaflet + OpenStreetMap
// Instalar: npm install leaflet @types/leaflet
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, Zap, MapPin, X, Battery } from "lucide-react";
import { useLiveData, statusMeta, ChargerStatus } from "@/components/dashboard/LiveDataProvider";

interface Props {
  onNavigate: (screen: string) => void;
  onSelectCharger: (id: string) => void;
}

// Local unico: FIAP - Unidade Paulista. Coordenadas APROXIMADAS (referencia); troque por as do local
// real (Google Maps > botao direito > copiar lat, lng). Os 8 carregadores ficam lado a lado no estacionamento.
const SITE_CENTER: [number, number] = [-23.5647, -46.6527];
const coords: Record<string, [number, number]> = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => [
    `CG-${String(i + 1).padStart(3, "0")}`,
    [SITE_CENTER[0] + (i < 4 ? 0.00008 : -0.00008), SITE_CENTER[1] + ((i % 4) - 1.5) * 0.00022] as [number, number],
  ]),
);

const pinColor: Record<ChargerStatus, string> = {
  available: "#22c55e",
  charging: "#00AEEF",
  preparing: "#FF7759",
  finishing: "#22c55e",
  faulted: "#6b7280",
};

const DARK_STYLE_ID = "chargegrid-leaflet-dark";

function buildIcon(status: ChargerStatus) {
  const color = pinColor[status];
  return L.divIcon({
    html: `<div style="
  width:28px; height:28px; border-radius:50%;
  background: ${color};
  border: 3px solid #121212;
  box-shadow: 0 0 10px ${color}88;
  display:flex; align-items:center; justify-content:center;
">
  <svg width='12' height='12' viewBox='0 0 24 24' fill='white'>
    <path d='M13 2L4.09 12.97 11 13l-1 9L20 4h-7z'/>
  </svg>
</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    className: "",
  });
}

export function MobileMap({ onNavigate, onSelectCharger }: Props) {
  const { chargers } = useLiveData();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const statusRef = useRef<Record<string, ChargerStatus>>({});

  // estilo dark dos tiles
  useEffect(() => {
    if (document.getElementById(DARK_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = DARK_STYLE_ID;
    style.textContent = `
      .leaflet-tile { filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7); }
      .leaflet-container { background: #0f0f0f; }
      .leaflet-control-attribution { background: rgba(0,0,0,0.5) !important; color: #888 !important; font-size: 9px; }
      .leaflet-control-attribution a { color: #aaa !important; }
    `;
    document.head.appendChild(style);
  }, []);

  // inicialização do mapa
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true }).setView(
      SITE_CENTER,
      18
    );
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // criação / atualização dos marcadores
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    chargers.forEach((c) => {
      const pos = coords[c.id];
      if (!pos) return;

      let marker = markersRef.current[c.id];
      if (!marker) {
        marker = L.marker(pos, { icon: buildIcon(c.status) });
        marker.on("click", () => setSelected(c.id));
        marker.addTo(map);
        markersRef.current[c.id] = marker;
        statusRef.current[c.id] = c.status;
      } else if (statusRef.current[c.id] !== c.status) {
        marker.setIcon(buildIcon(c.status));
        statusRef.current[c.id] = c.status;
      }
    });
  }, [chargers]);

  // filtro de busca — mostra/oculta pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const q = query.trim().toLowerCase();

    chargers.forEach((c) => {
      const marker = markersRef.current[c.id];
      if (!marker) return;
      const match = !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
      if (match) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    });
  }, [query, chargers]);

  const active = chargers.find((c) => c.id === selected) ?? null;

  return (
    <div className="flex flex-col h-full bg-background relative">
      <div className="flex-1 relative overflow-hidden">
        <div ref={containerRef} className="absolute inset-0 z-0" />

        {/* barra de busca */}
        <div className="absolute top-0 left-0 right-0 z-[500] p-3 bg-gradient-to-b from-background/90 to-transparent backdrop-blur-[2px]">
          <div className="flex items-center gap-2 px-3 h-9 rounded-xl bg-background/80 backdrop-blur-md border border-white/10">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar estação..."
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
            />
          </div>
        </div>

        {/* legenda */}
        <div
          className={`absolute left-3 z-[500] space-y-1 rounded-lg bg-background/80 backdrop-blur-md border border-white/10 px-2.5 py-2 ${
            active ? "bottom-[190px]" : "bottom-20"
          }`}
        >
          {[
            { c: "#22c55e", l: "Disponível" },
            { c: "#00AEEF", l: "Carregando" },
            { c: "#FF7759", l: "Preparando" },
            { c: "#6b7280", l: "Manutenção" },
          ].map((it) => (
            <div key={it.l} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: it.c }} />
              <span className="text-[9px] text-muted-foreground">{it.l}</span>
            </div>
          ))}
        </div>

        {/* card inferior */}
        {active && (
          <div className="absolute bottom-14 left-0 right-0 z-[600] backdrop-blur-md bg-background/80 border-t border-white/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-semibold text-foreground flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-primary" /> {active.name}
                </h4>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  {active.id} · {active.type}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[9px] px-2 py-0.5 rounded-full border ${statusMeta[active.status].cls}`}>
                  {statusMeta[active.status].label}
                </span>
                <button
                  onClick={() => setSelected(null)}
                  aria-label="Fechar detalhes"
                  className="w-6 h-6 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 mt-2">
              <span className="text-[10px] text-goodwe-blue flex items-center gap-1 tabular-nums">
                <Zap className="w-3 h-3" /> {active.currentPower.toFixed(1)} / {active.maxPower} kW
              </span>
              <span className="text-[10px] text-goodwe-green tabular-nums">
                R$ {active.tariff.toFixed(2).replace(".", ",")}/kWh
              </span>
            </div>

            {active.status === "available" && (
              <button
                onClick={() => {
                  onSelectCharger(active.id);
                  onNavigate("chargerDetail");
                }}
                className="w-full mt-3 h-9 rounded-xl bg-goodwe-green text-background text-xs font-semibold"
              >
                ⚡ Reservar agora
              </button>
            )}

            {(active.status === "charging" || active.status === "preparing") && (
              <div className="mt-2.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    {active.user ?? "Motorista"} · {active.vehicle ?? "Veículo"}
                  </span>
                  <span className="tabular-nums">{active.pct}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-goodwe-blue transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, active.pct))}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Conclusão estimada em {active.etaMin} min
                </p>
              </div>
            )}

            {active.status === "faulted" && (
              <p className="text-[10px] text-muted-foreground mt-2">Em manutenção</p>
            )}
          </div>
        )}
      </div>

      {/* navegação inferior */}
      <div className="absolute bottom-0 left-0 right-0 z-[700] h-14 bg-goodwe-card/90 backdrop-blur-lg border-t border-white/5 flex items-center justify-around px-4">
        {[
          { icon: Zap, label: "Início", active: false, screen: "home" },
          { icon: MapPin, label: "Mapa", active: true, screen: "map" },
          { icon: Battery, label: "Histórico", active: false, screen: "history" },
        ].map((item, i) => (
          <button key={i} onClick={() => onNavigate(item.screen)} className="flex flex-col items-center gap-0.5">
            <item.icon className={`w-5 h-5 ${item.active ? "text-primary" : "text-muted-foreground"}`} />
            <span className={`text-[10px] ${item.active ? "text-primary font-medium" : "text-muted-foreground"}`}>
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
