"use client";

import { useState, useRef, useEffect } from "react";
import { Bot, Send, Sparkles, Minimize2, Cpu, RefreshCw } from "lucide-react";
import { activeConnectedMembership } from "@/lib/active-connected-membership";

let messageSequence = 0;
const nextMessageId = (prefix: string) => `${prefix}-${++messageSequence}`;

interface Message {
  id: string;
  sender: "user" | "coach";
  text: string;
  timestamp: string;
  modelUsed?: string;
}

const PRESET_PROMPTS = [
  "Who should I start?",
  "Who should I add or drop?",
  "What changed since yesterday?",
  "Why is my top action recommended?",
  "Who should I draft?",
];

export function CoachBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "msg-welcome",
      sender: "coach",
      text: "👋 I'm Coach. Connected answers use your league's current decisions and evidence. Demo advice is labeled until a league is connected.",
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) triggerRef.current?.focus();
  }, [isOpen]);

  const handleSend = async (customText?: string) => {
    const textToSend = customText || input;
    if (!textToSend.trim() || loading) return;

    const userMsg: Message = {
      id: nextMessageId("usr"),
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInput("");
    setLoading(true);

    try {
      const history = messages
        .filter((m) => m.id !== "msg-welcome")
        .map((m) => ({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.text,
        }));
      history.push({ role: "user", content: textToSend });

      let coachContext: { demo: true } | { leagueId: string } | null = null;
      const contextResponse = await fetch("/api/context", { credentials: "same-origin" });
      if (contextResponse.ok) {
        const contextBody: unknown = await contextResponse.json();
        const membership = activeConnectedMembership(contextBody);
        const league = membership?.league;
        if (league && typeof league === "object" && "id" in league && typeof league.id === "string") {
          coachContext = { leagueId: league.id };
        }
      }
      if (!coachContext && process.env.NEXT_PUBLIC_DEMO_MODE === "true"
        && contextResponse.status === 401) coachContext = { demo: true };
      if (!coachContext) throw new Error("league_context_unavailable");

      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, ...coachContext }),
      });

      if (res.ok) {
        const data = await res.json();
        const coachMsg: Message = {
          id: nextMessageId("bot"),
          sender: "coach",
          text: data.reply,
          timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          modelUsed: data.modelUsed,
        };
        setMessages((prev) => [...prev, coachMsg]);
      } else {
        throw new Error("Coach bot response error");
      }
    } catch {
      const errorMsg: Message = {
        id: nextMessageId("err"),
        sender: "coach",
        text: "⚠️ Coach is temporarily unavailable. No live recommendation was generated; please retry when the evidence service is reachable.",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Trigger Button */}
      {!isOpen && (
        <button
          type="button"
          ref={triggerRef}
          aria-label="Open Coach"
          onClick={() => setIsOpen(true)}
          style={{
            position: "fixed",
            right: 24,
            bottom: "var(--coach-bottom)",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            borderRadius: 999,
            background: "var(--text)",
            color: "var(--bg)",
            boxShadow: "0 14px 40px rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.2)",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 14,
            transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <Sparkles size={18} style={{ color: "#ffd700" }} />
          <span>Ask Coach</span>
          <span
            style={{
              fontSize: 11,
              background: "rgba(255,255,255,0.2)",
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            Coach
          </span>
        </button>
      )}

      {/* Floating Coach Chat Drawer */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="coach-dialog-title"
          style={{
            position: "fixed",
            right: 24,
            bottom: "var(--coach-dialog-bottom)",
            zIndex: 50,
            width: "min(440px, calc(100vw - 32px))",
            height: "min(620px, calc(100vh - var(--coach-dialog-bottom) - 24px))",
            display: "flex",
            flexDirection: "column",
            borderRadius: 24,
            background: "var(--surface-strong)",
            border: "1px solid var(--line)",
            boxShadow: "0 24px 80px rgba(0,0,0,0.4)",
            overflow: "hidden",
            backdropFilter: "blur(24px)",
          }}
        >
          {/* Drawer Header */}
          <div
            style={{
              padding: "16px 20px",
              borderBottom: "1px solid var(--line)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: "50%",
                  background: "var(--text)",
                  color: "var(--bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Bot size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", gap: 6 }}>
                  <span id="coach-dialog-title">Coach War Room AI</span>
                  <span style={{ fontSize: 10, background: "var(--warn)", color: "#fff", padding: "1px 6px", borderRadius: 999 }}>EVIDENCE MODE</span>
                </div>
                <div className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
                  <Cpu size={12} /> Evidence service · provider reported per response
                </div>
              </div>
            </div>

            <button
              type="button"
              ref={closeButtonRef}
              aria-label="Close Coach War Room AI"
              onClick={() => setIsOpen(false)}
              style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer" }}
            >
              <Minimize2 size={18} />
            </button>
          </div>

          {/* Preset Suggestions */}
          <div
            style={{
              padding: "10px 14px",
              display: "flex",
              gap: 6,
              overflowX: "auto",
              borderBottom: "1px solid var(--line)",
              background: "rgba(0,0,0,0.02)",
            }}
          >
            {PRESET_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => handleSend(prompt)}
                style={{
                  whiteSpace: "nowrap",
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "5px 12px",
                  borderRadius: 999,
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  color: "var(--text)",
                  cursor: "pointer",
                }}
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Message List */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              padding: 16,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  alignSelf: msg.sender === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: msg.sender === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: msg.sender === "user" ? "20px 20px 4px 20px" : "20px 20px 20px 4px",
                    background: msg.sender === "user" ? "var(--text)" : "var(--surface)",
                    color: msg.sender === "user" ? "var(--bg)" : "var(--text)",
                    border: msg.sender === "user" ? "none" : "1px solid var(--line)",
                    fontSize: 13.5,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {msg.text}
                </div>
                <div
                  className="muted"
                  style={{
                    fontSize: 10,
                    marginTop: 4,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>{msg.timestamp}</span>
                  {msg.modelUsed && (
                    <span>• {msg.modelUsed.split("/").pop()}</span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div
                style={{
                  alignSelf: "flex-start",
                  padding: "10px 16px",
                  borderRadius: 20,
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <RefreshCw size={14} className="spin" style={{ color: "var(--good)" }} />
                <span>Coach is checking available evidence...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            style={{
              padding: 12,
              borderTop: "1px solid var(--line)",
              background: "var(--surface)",
              display: "flex",
              gap: 8,
            }}
          >
            <input
              aria-label="Ask Coach War Room AI"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Coach AI about lineups, trades, waivers..."
              style={{
                flex: 1,
                height: 44,
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: "var(--surface-strong)",
                color: "var(--text)",
                padding: "0 16px",
                fontSize: 13,
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                background: "var(--text)",
                color: "var(--bg)",
                border: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                opacity: loading || !input.trim() ? 0.5 : 1,
              }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
