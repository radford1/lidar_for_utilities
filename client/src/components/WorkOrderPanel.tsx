import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface WorkOrder {
  id: string;
  lat: number;
  lng: number;
  type: string;
  status: string;
  scheduledDate: string;
  crew: string;
  description: string;
  priority: string;
}

interface Props {
  workOrder: WorkOrder;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const priorityColor: Record<string, string> = {
  HIGH: '#ef4444',
  MEDIUM: '#f59e0b',
  LOW: '#22c55e',
};

const statusColor: Record<string, string> = {
  SCHEDULED: '#3b82f6',
  IN_PROGRESS: '#f59e0b',
  COMPLETED: '#22c55e',
  CANCELLED: '#6b7280',
};

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WorkOrderPanel({ workOrder, onClose }: Props) {
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  // Stream a response from the safety-chat SSE endpoint and append tokens
  // incrementally to the chat messages.
  const streamResponse = async (body: Record<string, unknown>) => {
    setChatLoading(true);

    // Add an empty assistant message that we'll fill token-by-token
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch('/api/safety-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // Grab session id from header (set before streaming begins)
      const sid = res.headers.get('x-session-id');
      if (sid) setSessionId(sid);

      if (!res.ok || !res.body) {
        // Non-streaming error — try to parse JSON body
        const text = await res.text();
        let errMsg = 'Request failed';
        try { errMsg = JSON.parse(text).error || errMsg; } catch { errMsg = text || errMsg; }
        setChatMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: `Error: ${errMsg}` };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) {
              setChatMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: 'assistant', content: `Error: ${parsed.error}` };
                return copy;
              });
              return;
            }
            if (parsed.content) {
              setChatMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, content: last.content + parsed.content };
                return copy;
              });
            }
          } catch {
            // incomplete JSON chunk — skip
          }
        }
      }
    } catch (err: any) {
      setChatMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { role: 'assistant', content: `Error: ${err.message}` };
        return copy;
      });
    } finally {
      setChatLoading(false);
    }
  };

  // When chat opens, auto-kick-off the safety agent with the lat/lng
  const openChat = async () => {
    setShowChat(true);
    if (chatMessages.length > 0) return; // already started

    const initialContent = `Lat/Long: ${workOrder.lat}, ${workOrder.lng}`;
    setChatMessages([{ role: 'user', content: initialContent }]);

    await streamResponse({ lat: workOrder.lat, lng: workOrder.lng });
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    const msg = text.trim();
    setChatInput('');

    const updatedMessages = [...chatMessages, { role: 'user' as const, content: msg }];
    setChatMessages(updatedMessages);

    await streamResponse({ messages: updatedMessages, sessionId: sessionId || undefined });
  };

  // --- Styles ---
  const panel: React.CSSProperties = {
    height: '100%',
    background: 'rgba(15, 23, 42, 0.96)',
    color: '#e2e8f0',
    display: 'flex',
    flexDirection: 'column',
    borderLeft: '1px solid rgba(148, 163, 184, 0.25)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    overflow: 'hidden',
  };

  const header: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 14px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.2)',
    flexShrink: 0,
  };

  const body: React.CSSProperties = {
    flex: '1 1 auto',
    overflow: 'auto',
    padding: '12px 14px',
  };

  const row: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 0',
  };

  const labelStyle: React.CSSProperties = { opacity: 0.7, fontSize: 12 };
  const valueStyle: React.CSSProperties = { fontWeight: 600 };

  // --- Render ---
  return (
    <div style={panel}>
      {/* Header */}
      <div style={header}>
        <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#fbbf24', fontSize: 16 }}>&#9650;</span>
          Work Order {workOrder.id}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Chat toggle button */}
          <button
            onClick={openChat}
            title="Safety Agent Chat"
            style={{
              background: showChat ? '#2563eb' : 'transparent',
              border: '1px solid rgba(148,163,184,0.3)',
              color: '#e2e8f0',
              borderRadius: 4,
              padding: '4px 8px',
              cursor: 'pointer',
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>💬</span>
            <span style={{ fontSize: 11 }}>Safety</span>
          </button>
          {/* Close button */}
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: '1px solid rgba(148,163,184,0.3)',
              color: '#e2e8f0',
              borderRadius: 4,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Detail / Chat body */}
      {!showChat ? (
        /* ---- DETAILS VIEW ---- */
        <div style={body}>
          <div style={row}>
            <span style={labelStyle}>Type</span>
            <span style={valueStyle}>{workOrder.type}</span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Status</span>
            <span
              style={{
                ...valueStyle,
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                background: statusColor[workOrder.status] || '#6b7280',
                color: '#fff',
              }}
            >
              {workOrder.status}
            </span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Priority</span>
            <span
              style={{
                ...valueStyle,
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                background: priorityColor[workOrder.priority] || '#6b7280',
                color: '#fff',
              }}
            >
              {workOrder.priority}
            </span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Scheduled</span>
            <span style={valueStyle}>{formatDate(workOrder.scheduledDate)}</span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Crew</span>
            <span style={valueStyle}>{workOrder.crew}</span>
          </div>
          <div style={row}>
            <span style={labelStyle}>Location</span>
            <span style={{ ...valueStyle, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              {workOrder.lat.toFixed(6)}, {workOrder.lng.toFixed(6)}
            </span>
          </div>

          <div style={{ marginTop: 14, borderTop: '1px solid rgba(148,163,184,0.15)', paddingTop: 10 }}>
            <div style={{ ...labelStyle, marginBottom: 4 }}>Description</div>
            <div style={{ fontSize: 12, lineHeight: 1.5, opacity: 0.9 }}>{workOrder.description}</div>
          </div>

          <button
            onClick={openChat}
            style={{
              marginTop: 18,
              width: '100%',
              padding: '10px 0',
              borderRadius: 6,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <span>💬</span> Run Safety Analysis
          </button>
        </div>
      ) : (
        /* ---- SAFETY CHAT VIEW ---- */
        <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Chat messages area */}
          <div
            style={{
              flex: '1 1 auto',
              overflow: 'auto',
              padding: 14,
              background: 'rgba(15, 23, 42, 0.6)',
            }}
          >
            {chatMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 16, flexShrink: 0, marginTop: 2 }}>
                  {m.role === 'user' ? '🧑' : '🤖'}
                </div>
                <div
                  style={{
                    background: m.role === 'user' ? 'rgba(148,163,184,0.15)' : 'rgba(37,99,235,0.12)',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(148,163,184,0.15)',
                    maxWidth: '100%',
                    overflow: 'auto',
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}
                  className="safety-chat-md"
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: (props) => (
                        <a {...props} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }} />
                      ),
                      h1: (props) => <h1 {...props} style={{ fontSize: 18, margin: '12px 0 6px', fontWeight: 700 }} />,
                      h2: (props) => <h2 {...props} style={{ fontSize: 16, margin: '10px 0 4px', fontWeight: 700 }} />,
                      h3: (props) => <h3 {...props} style={{ fontSize: 14, margin: '8px 0 4px', fontWeight: 700 }} />,
                      ul: (props) => <ul {...props} style={{ paddingLeft: 18, margin: '4px 0' }} />,
                      ol: (props) => <ol {...props} style={{ paddingLeft: 18, margin: '4px 0' }} />,
                      li: (props) => <li {...props} style={{ marginBottom: 2 }} />,
                      p: (props) => <p {...props} style={{ margin: '4px 0' }} />,
                      code: ({ children, className, ...rest }) => {
                        const isBlock = className?.includes('language-');
                        return isBlock ? (
                          <pre
                            style={{
                              background: '#0f172a',
                              color: '#e2e8f0',
                              padding: 8,
                              borderRadius: 6,
                              overflow: 'auto',
                              fontSize: 12,
                            }}
                          >
                            <code {...rest}>{children}</code>
                          </pre>
                        ) : (
                          <code
                            {...rest}
                            style={{
                              background: 'rgba(148,163,184,0.2)',
                              padding: '2px 4px',
                              borderRadius: 4,
                              fontSize: 12,
                            }}
                          >
                            {children}
                          </code>
                        );
                      },
                      hr: () => <hr style={{ border: 'none', borderTop: '1px solid rgba(148,163,184,0.2)', margin: '10px 0' }} />,
                      strong: (props) => <strong {...props} style={{ color: '#f1f5f9' }} />,
                      table: (props) => (
                        <table
                          {...props}
                          style={{ borderCollapse: 'collapse', width: '100%', margin: '6px 0', fontSize: 12 }}
                        />
                      ),
                      th: (props) => (
                        <th
                          {...props}
                          style={{
                            textAlign: 'left',
                            padding: '4px 8px',
                            borderBottom: '1px solid rgba(148,163,184,0.25)',
                            fontWeight: 600,
                          }}
                        />
                      ),
                      td: (props) => (
                        <td
                          {...props}
                          style={{
                            padding: '4px 8px',
                            borderBottom: '1px solid rgba(148,163,184,0.1)',
                          }}
                        />
                      ),
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8' }}>
                <div
                  style={{
                    width: 16,
                    height: 16,
                    border: '2px solid #475569',
                    borderTopColor: '#3b82f6',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }}
                />
                <span>Analyzing safety hazards...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Chat input */}
          <div
            style={{
              padding: 10,
              borderTop: '1px solid rgba(148,163,184,0.2)',
              display: 'flex',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <textarea
              rows={2}
              placeholder="Ask follow-up..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage(chatInput);
                }
              }}
              style={{
                flex: 1,
                resize: 'none',
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.3)',
                background: 'rgba(15,23,42,0.5)',
                color: '#e2e8f0',
                padding: 8,
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              disabled={chatLoading}
              onClick={() => void sendMessage(chatInput)}
              style={{
                alignSelf: 'flex-end',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 12px',
                cursor: chatLoading ? 'not-allowed' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
                opacity: chatLoading ? 0.6 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
