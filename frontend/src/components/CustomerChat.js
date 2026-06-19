import React, { useState, useRef, useEffect } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

const STARTERS = [
  { label: 'Request a refund', text: "Hi, I'd like to request a refund. My name is Alice Johnson and my order ID is ORD-10021." },
  { label: 'Check refund status', text: "I submitted a refund request. My name is Grace Lee, order ORD-10301." },
  { label: 'Item not as described', text: "The item I received is completely different from what I ordered. I'm Noah Harris, order ORD-10589." },
  { label: 'Final sale question', text: "I want to return a jacket. Isabella Brown, order ORD-10389." },
];

function resolutionContent(resolution) {
  if (resolution === 'approved') return { cls: 'approved', icon: '✅', text: 'Refund approved. You will receive your funds in 3–5 business days.' };
  if (resolution === 'denied')   return { cls: 'denied',   icon: '❌', text: 'Refund request denied per our policy. See the message above for details.' };
  if (resolution === 'escalated') return { cls: 'escalated', icon: '⏳', text: 'Escalated for human review. A team member will follow up within 24 hours.' };
  return null;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function CustomerChat() {
  const [messages, setMessages]       = useState([]);
  const [ticketId, setTicketId]       = useState(null);
  const [status, setStatus]           = useState(null);
  const [resolution, setResolution]   = useState(null);
  const [input, setInput]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [lookupInput, setLookupInput] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Persist ticket ID across page reloads
  useEffect(() => {
    if (ticketId) localStorage.setItem('loopp_ticket_id', ticketId);
  }, [ticketId]);

  // Auto-resume on mount if a ticket was previously active
  useEffect(() => {
    const saved = localStorage.getItem('loopp_ticket_id');
    if (saved) loadTicket(saved, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const loadTicket = async (id, silent = false) => {
    const normalized = id.trim().toUpperCase();
    if (!normalized) return;
    setLookupLoading(true);
    setLookupError('');
    try {
      const res = await fetch(`${API}/api/chat/${normalized}`);
      if (!res.ok) throw new Error('Ticket not found. Please check the number and try again.');
      const data = await res.json();
      setTicketId(data.ticket_id);
      setStatus(data.status);
      setResolution(data.resolution);
      setMessages(data.messages);
      setLookupInput('');
    } catch (e) {
      if (silent) {
        localStorage.removeItem('loopp_ticket_id');
      } else {
        setLookupError(e.message);
      }
    } finally {
      setLookupLoading(false);
    }
  };

  const send = async (text) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput('');
    setLoading(true);

    // Optimistically append user message
    const tempUser = { role: 'user', content: msg, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, tempUser]);

    try {
      const res = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: ticketId, message: msg }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setTicketId(data.ticket_id);
      setStatus(data.status);
      setResolution(data.resolution);
      // Replace with server-authoritative message list
      setMessages(data.messages);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Connection error: ${e.message}. Please check that the backend is running.`,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const closeTicket = async () => {
    if (!ticketId) return;
    try {
      await fetch(`${API}/api/chat/${ticketId}/close`, { method: 'POST' });
      setStatus('closed');
    } catch {}
  };

  const startNew = () => {
    localStorage.removeItem('loopp_ticket_id');
    setMessages([]); setTicketId(null); setStatus(null); setResolution(null); setInput('');
    setLookupInput(''); setLookupError('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const isClosed = status === 'closed';
  const resInfo  = resolutionContent(resolution);
  const showWelcome = messages.length === 0 && !loading;

  return (
    <div className="customer-shell">
      {/* Header */}
      <header className="customer-header">
        <div className="brand">
          <span className="brand-logo">↩</span>
          <span className="brand-name">Loopp</span>
          <span className="brand-dept">Support</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {ticketId && (
            <div className="ticket-chip">
              <span className="ticket-chip-dot" />
              {ticketId}
            </div>
          )}
          {ticketId && (
            <button className="btn-ghost" style={{ fontSize: 11 }} onClick={startNew}>
              New request
            </button>
          )}
        </div>
      </header>

      {/* Notice bar */}
      <div className="notice-bar">
        <span>🔒</span>
        <span>This is an AI-powered support agent. For complex issues, you may be escalated to a human agent.</span>
      </div>

      {/* Messages */}
      <div className="messages-area">
        {showWelcome && (
          <div className="welcome-card">
            <div className="welcome-icon">👋</div>
            <h2>How can we help you today?</h2>
            <p>
              Our AI agent can help you check refund eligibility, submit requests,
              and understand our return policy — 24/7 with no wait time.
            </p>
            <div className="starter-grid">
              {STARTERS.map((s, i) => (
                <button key={i} className="starter-btn" onClick={() => send(s.text)}>
                  <span className="starter-label">{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.text.slice(0, 48)}…</span>
                </button>
              ))}
            </div>

            <div className="lookup-section">
              <div className="lookup-divider"><span>or resume a previous conversation</span></div>
              <div className="lookup-row">
                <input
                  className="lookup-input"
                  type="text"
                  placeholder="Enter ticket number (e.g. TKT-AB12CD34)"
                  value={lookupInput}
                  onChange={e => { setLookupInput(e.target.value); setLookupError(''); }}
                  onKeyDown={e => e.key === 'Enter' && loadTicket(lookupInput)}
                  disabled={lookupLoading}
                />
                <button
                  className="btn-ghost"
                  onClick={() => loadTicket(lookupInput)}
                  disabled={!lookupInput.trim() || lookupLoading}
                >
                  {lookupLoading ? '…' : 'Load'}
                </button>
              </div>
              {lookupError && <div className="lookup-error">{lookupError}</div>}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg-row ${m.role}`}>
            <div className="msg-avatar">{m.role === 'user' ? '👤' : '🤖'}</div>
            <div className="msg-body">
              <div className="msg-bubble">{m.content}</div>
              <div className="msg-time">{formatTime(m.timestamp)}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="msg-row assistant">
            <div className="msg-avatar">🤖</div>
            <div className="typing-bubble">
              <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
            </div>
          </div>
        )}

        {/* Resolution banner — shown once agent reaches a decision */}
        {resInfo && !loading && (
          <div className={`resolution-banner ${resInfo.cls}`}>
            <span className="resolution-banner-icon">{resInfo.icon}</span>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                {resolution === 'approved' ? 'Refund Approved' : resolution === 'denied' ? 'Request Denied' : 'Escalated to Human'}
              </div>
              <div style={{ fontSize: 12.5, opacity: 0.85 }}>{resInfo.text}</div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      {isClosed ? (
        <div className="closed-bar">
          This conversation is closed. <button className="btn-ghost" style={{ marginLeft: 10 }} onClick={startNew}>Start a new request</button>
        </div>
      ) : (
        <div className="chat-input-area">
          <div className="input-row">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              rows={1}
              placeholder="Describe your issue or type your order ID…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
            />
            <button className="send-btn" onClick={() => send()} disabled={!input.trim() || loading}>↑</button>
          </div>
          <div className="input-footer">
            <span className="input-hint">Enter to send · Shift+Enter for new line</span>
            {resolution && !isClosed && (
              <button className="btn-ghost" style={{ fontSize: 11 }} onClick={closeTicket}>
                Close ticket
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
