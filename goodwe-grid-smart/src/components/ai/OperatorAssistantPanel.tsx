import { FormEvent, useEffect, useRef, useState } from "react";
import { Zap, X, Send } from "lucide-react";
import { useAssistantChat } from "./useAssistantChat";
import { ChatBubble, TypingDots, SuggestionChips } from "./ChatBubbles";

const suggestions = [
  "Quais estações estão em manutenção?",
  "Faturamento de hoje",
  "Sessões ativas agora",
  "Como está a carga da rede?",
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OperatorAssistantPanel({ open, onClose }: Props) {
  const { messages, typing, send } = useAssistantChat(
    "operator",
    "Olá! Sou o assistente do ChargeGrid. Pergunte sobre estações, sessões, faturamento ou carga da rede."
  );
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
    setInput("");
  };

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-[380px] max-w-[92vw] bg-card/95 backdrop-blur-xl border-l border-white/10 flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center gap-2.5 px-4 py-3 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center glow-red">
            <Zap className="w-3.5 h-3.5 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-foreground">Assistente ChargeGrid</p>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <span className="status-dot text-goodwe-green" /> Conectado aos dados ao vivo
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar assistente"
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map((m) => (
            <ChatBubble key={m.id} msg={m} />
          ))}
          {typing && <TypingDots />}
        </div>

        <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2">
          <SuggestionChips items={suggestions} onPick={send} />
          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre estações, sessões ou faturamento..."
              className="flex-1 bg-muted/60 border border-white/10 rounded-xl px-3 py-2.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Enviar"
              className="w-9 h-9 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-40 transition"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
