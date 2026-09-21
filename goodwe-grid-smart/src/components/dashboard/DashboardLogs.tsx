import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal, Activity, Wifi } from "lucide-react";
import { backend as api } from "@/lib/backend/client";
import { parseUtc } from "@/lib/backend/mappers";
import type { ApiOcppMessage, ApiOcppStatus } from "@/lib/backend/types";
import { useLiveData } from "./LiveDataProvider";
import { DashboardBackend } from "./DashboardBackend";

const levelStyles: Record<string, string> = {
  INFO: "text-goodwe-blue",
  ACK: "text-goodwe-green",
  WARN: "text-goodwe-orange",
  ERR: "text-primary",
};

const POLL_MS = 3000;
const MAX_PAYLOAD = 120;

/** "Authorize" + CALL -> "Authorize.req"; + CALLRESULT -> "Authorize.conf"; + CALLERROR -> "Authorize.err" (convencao do OCPP). */
export function ocppLabel(m: Pick<ApiOcppMessage, "action" | "message_type">): string {
  const suffix = m.message_type === 2 ? "req" : m.message_type === 3 ? "conf" : m.message_type === 4 ? "err" : "?";
  return `${m.action || "—"}.${suffix}`;
}

export function compactPayload(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload);
  return text.length > MAX_PAYLOAD ? `${text.slice(0, MAX_PAYLOAD)}…` : text;
}

export function DashboardLogs() {
  const { logs, backend } = useLiveData();
  const token = backend.operatorToken;
  const online = backend.status === "online" && !!token;

  const [messages, setMessages] = useState<ApiOcppMessage[]>([]);
  const [status, setStatus] = useState<ApiOcppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!online || !token) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [msgs, st] = await Promise.all([api.ocppMessages(token, 80), api.ocppStatus(token)]);
        if (cancelled) return;
        setMessages([...msgs].reverse()); // do mais antigo para o mais novo
        setStatus(st);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "erro");
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [online, token]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, messages]);

  const lastMinute = useMemo(() => {
    const cutoff = Date.now() - 60_000;
    return messages.filter((m) => parseUtc(m.created_at).getTime() >= cutoff).length;
  }, [messages]);

  const kpis = online
    ? [
        {
          label: "Carregadores conectados (OCPP 1.6J)",
          value: status ? `${status.connected.length}` : "—",
          icon: Wifi,
          color: "text-goodwe-green",
        },
        { label: "Mensagens no último minuto", value: `${lastMinute}`, icon: Activity, color: "text-goodwe-blue" },
        {
          label: "Origem dos carregadores",
          value: status ? (status.simulator ? "Virtuais (simulados)" : "Externos") : "—",
          icon: Terminal,
          color: "text-goodwe-orange",
        },
      ]
    : [
        { label: "Conexões OCPP 1.6J", value: "Simuladas", icon: Wifi, color: "text-goodwe-orange" },
        { label: "Mensagens / min", value: "—", icon: Activity, color: "text-muted-foreground" },
        { label: "Modo", value: "Sem servidor", icon: Terminal, color: "text-goodwe-orange" },
      ];

  return (
    <div className="space-y-4 fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {kpis.map((s, i) => (
          <div key={i} className="glass-card card-hover p-4">
            <s.icon className={`w-5 h-5 mb-2 ${s.color}`} />
            <p className="text-2xl font-bold text-foreground">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-black/40">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-primary/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-goodwe-orange/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-goodwe-green/70" />
            </div>
            <span className="text-[11px] font-mono text-muted-foreground ml-2">
              {online
                ? "ocpp-csms@chargegrid — OCPP 1.6J / WebSocket (mensagens reais gravadas no banco)"
                : "ocpp-csms@goodwe:~ — stream SIMULADO (sem servidor)"}
            </span>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] text-goodwe-green font-mono">
            <span className="status-dot text-goodwe-green" /> {online ? "AO VIVO" : "SIMULADO"}
          </span>
        </div>

        <div ref={scrollRef} className="terminal-scroll h-[420px] overflow-y-auto font-mono text-[11px] leading-relaxed p-4 bg-black/60">
          {online ? (
            <>
              {error && <p className="text-goodwe-orange">Não foi possível ler as mensagens: {error}</p>}
              {!error && messages.length === 0 && (
                <p className="text-muted-foreground">
                  Nenhuma mensagem OCPP ainda. Ligue os carregadores virtuais com <span className="text-foreground">OCPP_SIMULATOR=true</span>{" "}
                  em <span className="text-foreground">backend/.env</span> (ou conecte um carregador em ws://…/ocpp/CG-001).
                </p>
              )}
              {messages.map((m) => (
                <div key={m.id} data-testid="ocpp-line" className="flex gap-3 py-0.5 hover:bg-white/[0.02]">
                  <span className="text-muted-foreground/60 shrink-0">
                    {parseUtc(m.created_at).toLocaleTimeString("pt-BR", { hour12: false })}
                  </span>
                  <span className={`shrink-0 w-24 ${m.direction === "in" ? "text-goodwe-blue" : "text-goodwe-green"}`}>
                    {m.direction === "in" ? `${m.charge_point_id} ▶ CSMS` : `CSMS ▶ ${m.charge_point_id}`}
                  </span>
                  <span className={`shrink-0 w-40 font-semibold ${m.message_type === 4 ? "text-primary" : "text-foreground"}`}>
                    {ocppLabel(m)}
                  </span>
                  <span className="text-foreground/70 break-all">{compactPayload(m.payload_json)}</span>
                </div>
              ))}
            </>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="flex gap-3 py-0.5 hover:bg-white/[0.02]">
                <span className="text-muted-foreground/60 shrink-0">{l.ts}</span>
                <span className={`shrink-0 w-12 font-semibold ${levelStyles[l.level]}`}>[{l.level}]</span>
                <span className="shrink-0 w-20 text-goodwe-blue">{l.source}</span>
                <span className="text-foreground/90">{l.msg}</span>
              </div>
            ))
          )}
          <div className="flex items-center gap-2 pt-2 text-goodwe-green">
            <span>$</span>
            <span className="w-2 h-3.5 bg-goodwe-green/80 animate-pulse" />
          </div>
        </div>
      </div>

      <DashboardBackend only="integration" />
    </div>
  );
}
