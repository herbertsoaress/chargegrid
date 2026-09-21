import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, X, Send } from "lucide-react";
import { useAssistantChat } from "./useAssistantChat";
import { ChatBubble, TypingDots, SuggestionChips } from "./ChatBubbles";

const suggestions = [
  "Estação mais próxima disponível",
  "Status da minha recarga",
  "Quanto vai custar?",
];

export function MobileAssistant() {
  const [open, setOpen] = useState(false);
  const { messages, typing, send } = useAssistantChat(
    "driver",
    "Oi! Posso te ajudar a encontrar uma estação, ver o status da sua recarga ou tirar dúvidas. O que precisa?"
  );
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, open]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
    setInput("");
  };

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir assistente"
          className="absolute bottom-[72px] right-4 z-30 w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center assistant-pulse"
        >
          <Bot className="w-6 h-6" />
        </button>
      )}

      {open && (
        <div className="absolute inset-0 z-40">
          <div onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute bottom-0 left-0 right-0 h-[70%] bg-card/95 backdrop-blur-xl border-t border-white/10 rounded-t-2xl flex flex-col">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
              <div className="w-7 h-7 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold text-foreground">Assistente ChargeGrid</p>
                <p className="text-[9px] text-muted-foreground">Sempre disponível</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Fechar assistente"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
              {messages.map((m) => (
                <ChatBubble key={m.id} msg={m} compact />
              ))}
              {typing && <TypingDots />}
            </div>

            <div className="px-3 pb-3 pt-2 border-t border-white/5 space-y-2">
              <SuggestionChips items={suggestions} onPick={send} />
              <form onSubmit={onSubmit} className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Escreva sua dúvida..."
                  className="flex-1 bg-muted/60 border border-white/10 rounded-xl px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition"
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Enviar"
                  className="w-8 h-8 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 transition"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
