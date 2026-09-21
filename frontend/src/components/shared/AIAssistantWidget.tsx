import { Bot, MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const QUICK_QUESTIONS = [
  "Status da minha sessao",
  "Quanto ja gastei?",
  "Qual modo devo escolher?",
  "Como funciona o pagamento?",
];

export function AIAssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", text: "Oi! Posso ajudar com a sua sessao, os modos de recarga, pagamento e historico. O que voce quer saber?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await api.assistantQuery(question);
      setMessages((prev) => [...prev, { role: "assistant", text: res.answer }]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Nao consegui falar com o servidor agora. Tente de novo em instantes." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute bottom-20 right-4 z-30">
      {open && (
        <div className="animate-fade-in-up mb-3 flex h-[26rem] w-72 flex-col overflow-hidden rounded-xl border border-white/10 bg-navy-800/95 shadow-2xl shadow-black/50 backdrop-blur-md sm:w-80">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-navy-900/80 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-red/15 text-brand-red ring-1 ring-inset ring-brand-red/30">
                <Bot className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-medium leading-none text-white">Assistente ChargeGrid</p>
                <p className="mt-0.5 text-[11px] text-white/40">Respostas em tempo real</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Fechar assistente"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "animate-fade-in-up max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed",
                  m.role === "user"
                    ? "ml-auto bg-brand-red text-white shadow-sm shadow-brand-red/20"
                    : "bg-white/10 text-white/90 ring-1 ring-inset ring-white/10",
                )}
              >
                {m.text}
              </div>
            ))}
            {loading && <p className="text-[11px] text-white/40">Digitando...</p>}
          </div>

          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70 transition-colors hover:border-brand-red/40 hover:text-white"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            className="flex items-center gap-2 border-t border-white/10 p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              className="flex-1 rounded-lg border border-white/10 bg-navy-900 px-3 py-2 text-xs text-white outline-none transition-colors duration-200 focus:border-brand-red focus:ring-2 focus:ring-brand-red/20"
              placeholder="Digite sua pergunta..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={loading} className="shrink-0 px-2.5">
              <Send className="h-3.5 w-3.5" />
            </Button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-full bg-brand-red text-white shadow-lg shadow-brand-red/30 transition-all duration-200 hover:bg-brand-red-dark hover:shadow-xl hover:shadow-brand-red/40 active:scale-95",
          open && "rotate-90",
        )}
        aria-label={open ? "Fechar assistente" : "Abrir assistente"}
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" fill="currentColor" />}
      </button>
    </div>
  );
}
