import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { SessionMode, Station } from "@/lib/types";

const MODES: { value: SessionMode; label: string; icon: string }[] = [
  { value: "rapido", label: "Rapido", icon: "⚡" },
  { value: "economico", label: "Economico", icon: "🌿" },
  { value: "sustentavel", label: "Sustentavel", icon: "☀️" },
];

export function StationList() {
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedCharger, setSelectedCharger] = useState<number | null>(null);
  const [mode, setMode] = useState<SessionMode>("rapido");
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.listStations().then(setStations).catch(() => setStations([]));
  }, []);

  const startSession = async () => {
    if (!selectedCharger) return;
    setStarting(true);
    try {
      const session = await api.createSession(selectedCharger, mode);
      navigate(`/app/sessao/${session.id}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Estacoes proximas</h1>

      {stations.map((station) => (
        <Card key={station.id}>
          <CardHeader>
            <CardTitle className="text-white">{station.name}</CardTitle>
            <Badge variant="outline" className="capitalize">
              {station.type}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-white/50">{station.address}</p>
            <div className="grid grid-cols-2 gap-2">
              {station.chargers.map((c) => (
                <button
                  key={c.id}
                  disabled={c.status !== "livre"}
                  onClick={() => setSelectedCharger(c.id)}
                  className={`rounded-lg border p-3 text-left text-sm disabled:opacity-40 ${
                    selectedCharger === c.id ? "border-brand-red bg-brand-red/10" : "border-white/10"
                  }`}
                >
                  <p className="font-medium">{c.code}</p>
                  <p className="text-xs text-white/50">{c.max_power_kw} kW</p>
                  <Badge variant={c.status === "livre" ? "success" : "outline"} className="mt-1 capitalize">
                    {c.status}
                  </Badge>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      {selectedCharger && (
        <Card>
          <CardHeader>
            <CardTitle>Escolha o modo de recarga</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setMode(m.value)}
                  className={`rounded-lg border p-2 text-center text-xs ${
                    mode === m.value ? "border-brand-red bg-brand-red/10" : "border-white/10 text-white/60"
                  }`}
                >
                  <div className="text-lg">{m.icon}</div>
                  {m.label}
                </button>
              ))}
            </div>
            <Button className="w-full" onClick={startSession} disabled={starting}>
              {starting ? "Iniciando..." : "Iniciar sessao"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
