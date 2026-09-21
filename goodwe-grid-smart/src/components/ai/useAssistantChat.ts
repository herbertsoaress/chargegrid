import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveData, statusMeta } from "@/components/dashboard/LiveDataProvider";

export type ChatMsg = {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** "ia" quando quem respondeu foi o Gemini (via backend); ausente nas demais respostas. */
  origem?: "ia";
};

const MIN_TYPING_MS = 900;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const brl = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

export function useAssistantChat(role: "driver" | "operator", greeting?: string) {
  const { chargers, totals, activeSessions, completedSessions, backend, askAssistant } = useLiveData();
  const [messages, setMessages] = useState<ChatMsg[]>(
    greeting ? [{ id: 0, role: "assistant", text: greeting }] : []
  );
  const [typing, setTyping] = useState(false);
  const idRef = useRef(1);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // O que o usuario esta vendo na tela (carregadores simulados no navegador). Vai junto da
  // pergunta para a IA nao contradizer o painel.
  const screenSnapshot = useCallback(
    () =>
      [
        ...chargers.map(
          (c) =>
            `${c.id} ${c.name}: ${c.status}, ${c.currentPower.toFixed(1)}/${c.maxPower} kW, ${Math.round(c.pct)}%, ETA ${c.etaMin} min, R$ ${c.tariff.toFixed(2)}/kWh`,
        ),
        `Rede: ${totals.distributedPower} kW de ${totals.networkLimit} kW (${Math.round(totals.networkLoadPct)}%)`,
      ].join("\n"),
    [chargers, totals],
  );

  const answer = useCallback(
    (q: string): string => {
      const t = q.toLowerCase();
      const busy = chargers.filter((c) => c.status === "charging" || c.status === "preparing");
      const free = chargers.filter((c) => c.status === "available");
      const faulted = chargers.filter((c) => c.status === "faulted");

      if (/manuten|falha|defeito|problema/.test(t)) {
        return faulted.length
          ? `Estações em manutenção agora: ${faulted
              .map((c) => `**${c.name}** (${c.id})`)
              .join(", ")}. As demais ${chargers.length - faulted.length} estações operam normalmente.`
          : "Nenhuma estação em manutenção neste momento — as 8 estações estão operacionais.";
      }

      if (/fatur|receita|ganho|dinheiro|quanto rendeu/.test(t)) {
        const ticket = totals.activeSessions ? totals.revenueToday / totals.activeSessions : 0;
        return `Faturamento de hoje: **${brl(totals.revenueToday)}** com ${totals.kwhToday.toFixed(
          1
        )} kWh entregues. Ticket médio por sessão em andamento: ${brl(ticket)}.`;
      }

      if (/custo|custar|pre[çc]o|tarifa/.test(t)) {
        const min = Math.min(...chargers.map((c) => c.tariff));
        const max = Math.max(...chargers.map((c) => c.tariff));
        return `As tarifas variam de **${brl(min)}/kWh** (noturno/fora de ponta) a **${brl(
          max
        )}/kWh** (ponta, 18h–21h). Uma recarga de 30 kWh sai entre ${brl(30 * min)} e ${brl(30 * max)}.`;
      }

      if (/sess[õo]|ativa|carregando|agora/.test(t)) {
        if (!busy.length) return "Não há sessões ativas neste momento.";
        return `Há **${busy.length} sessões ativas**:\n${busy
          .map(
            (c) =>
              `• ${c.name} — ${c.user ?? "usuário"} (${c.vehicle ?? "veículo"}) · ${Math.round(
                c.pct
              )}% · ${c.currentPower.toFixed(1)} kW · ETA ${c.etaMin} min`
          )
          .join("\n")}`;
      }

      if (/pr[óo]xim|dispon[íi]|livre|encontrar|estação mais/.test(t)) {
        if (!free.length) {
          const soon = [...busy].sort((a, b) => a.etaMin - b.etaMin)[0];
          return soon
            ? `Todas ocupadas agora. A próxima a liberar é **${soon.name}** em ~${soon.etaMin} min.`
            : "Nenhuma estação livre no momento.";
        }
        const best = [...free].sort((a, b) => a.tariff - b.tariff)[0];
        return `Recomendo **${best.name}** (${best.id}): livre, ${best.type}, até ${
          best.maxPower
        } kW e tarifa de ${brl(best.tariff)}/kWh. Outras livres: ${free
          .filter((c) => c.id !== best.id)
          .map((c) => c.name)
          .join(", ") || "nenhuma"}.`;
      }

      if (/status da minha|minha recarga|meu carro/.test(t)) {
        const mine = activeSessions[0] ?? busy[0];
        if (!mine) return "Você não tem recarga em andamento. Posso indicar uma estação livre?";
        if ("currentPct" in mine) {
          return `Sua recarga está em **${Math.round(mine.currentPct)}%**, ${mine.kwh.toFixed(
            1
          )} kWh entregues, custo parcial de ${brl(mine.estimatedCost)}. Saída prevista: ${
            mine.departureTime
          }.`;
        }
        return `Sua recarga está em **${Math.round(mine.pct)}%** com ${mine.currentPower.toFixed(
          1
        )} kW · ETA ${mine.etaMin} min.`;
      }

      if (/rede|capacidade|carga|balanceamento|dlb/.test(t)) {
        return `A rede está em **${Math.round(totals.networkLoadPct)}%** da capacidade (${totals.distributedPower} kW de ${totals.networkLimit} kW). O balanceamento dinâmico redistribui potência entre as estações para não estourar a demanda contratada.`;
      }

      if (/hist[óo]ric|encerrad|conclu/.test(t)) {
        return completedSessions.length
          ? `Últimas sessões encerradas: ${completedSessions
              .slice(0, 3)
              .map((s) => `${s.chargerName} · ${s.kwh.toFixed(1)} kWh · ${brl(s.cost)}`)
              .join(" | ")}`
          : "Ainda não há sessões encerradas nesta simulação.";
      }

      return `Posso ajudar com estações (${free.length} livres, ${busy.length} em uso, ${
        faulted.length
      } em manutenção), sessões ativas, tarifas, faturamento (${brl(
        totals.revenueToday
      )} hoje) e carga da rede (${Math.round(totals.networkLoadPct)}%). Sobre o que quer saber?`;
    },
    [chargers, totals, activeSessions, completedSessions]
  );

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      const history = messagesRef.current
        .filter((m) => m.id !== 0)
        .slice(-6)
        .map((m) => ({ role: m.role, text: m.text.slice(0, 800) }));
      setMessages((m) => [...m, { id: idRef.current++, role: "user", text: t }]);
      setTyping(true);

      const localReply = answer(t);
      const remote = backend.status === "online" ? askAssistant(role, t, history, screenSnapshot()) : Promise.resolve(null);
      // Com backend: so troca a resposta local quando quem respondeu foi a IA (as respostas por
      // regras do backend vem do banco e nao enxergam os carregadores simulados da tela).
      Promise.all([remote, sleep(MIN_TYPING_MS)]).then(([result]) => {
        if (!aliveRef.current) return;
        const fromAi = result?.origem === "ia";
        setMessages((m) => [
          ...m,
          { id: idRef.current++, role: "assistant", text: fromAi ? result.answer : localReply, ...(fromAi && { origem: "ia" as const }) },
        ]);
        setTyping(false);
      });
    },
    [answer, askAssistant, backend.status, role, screenSnapshot],
  );

  return { messages, typing, send, statusMeta };
}
