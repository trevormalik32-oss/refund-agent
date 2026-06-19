import React, { useState, useEffect, useCallback } from 'react';

const API = process.env.REACT_APP_API_URL || 'http://localhost:8000';

// ── Helpers ───────────────────────────────────────────────────────

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusBadge(status, resolution) {
  if (status === 'closed')     return <span className="badge badge-gray">Closed</span>;
  if (status === 'escalated')  return <span className="badge badge-yellow">Escalated</span>;
  if (status === 'resolved') {
    if (resolution === 'approved') return <span className="badge badge-green">Approved</span>;
    if (resolution === 'denied')   return <span className="badge badge-red">Denied</span>;
    return <span className="badge badge-blue">Resolved</span>;
  }
  if (status === 'in_progress') return <span className="badge badge-accent">Active</span>;
  return <span className="badge badge-gray">Open</span>;
}

function traceStepIcon(step) {
  if (step.type === 'tool_call') return step.is_error ? '❌' : '🔧';
  if (step.type === 'llm_call')  return '🧠';
  if (step.type === 'final_response') return '✅';
  return '·';
}

function traceStepLabel(step) {
  if (step.type === 'tool_call') return `Tool: ${step.tool}`;
  if (step.type === 'llm_call')  return `LLM call (${step.input_tokens || 0}↑ ${step.output_tokens || 0}↓ tokens, stop: ${step.stop_reason})`;
  return 'Final response';
}

// ── TraceStep (collapsible) ───────────────────────────────────────

function TraceStep({ step, idx }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="trace-step">
      <div className="trace-step-hdr" onClick={() => setOpen(o => !o)}>
        <span className="trace-step-icon">{traceStepIcon(step)}</span>
        <span className="trace-step-name">{traceStepLabel(step)}</span>
        <div className="trace-step-meta">
          {'latency_ms' in step && <span className="trace-ms">{step.latency_ms}ms</span>}
          {step.type === 'tool_call' && step.is_error && <span className="badge badge-red" style={{fontSize:9}}>error</span>}
        </div>
        <span className={`trace-chevron ${open ? 'open' : ''}`}>▶</span>
      </div>
      {open && (
        <div className="trace-step-body">
          {step.type === 'tool_call' && (
            <div className="trace-kv">
              <div className="trace-kv-row">
                <span className="trace-kv-k">Input</span>
                <pre className="trace-json">{JSON.stringify(step.input, null, 2)}</pre>
              </div>
              <div className="trace-kv-row">
                <span className="trace-kv-k">Output</span>
                <pre className="trace-json">{JSON.stringify(step.output, null, 2)}</pre>
              </div>
              {step.is_error && <div className="trace-error">Tool call failed — see output for error detail.</div>}
            </div>
          )}
          {step.type === 'llm_call' && (
            <div className="trace-kv">
              <div className="trace-kv-row"><span className="trace-kv-k">Tokens in</span><span className="trace-kv-v">{step.input_tokens}</span></div>
              <div className="trace-kv-row"><span className="trace-kv-k">Tokens out</span><span className="trace-kv-v">{step.output_tokens}</span></div>
              <div className="trace-kv-row"><span className="trace-kv-k">Stop reason</span><span className="trace-kv-v">{step.stop_reason}</span></div>
              <div className="trace-kv-row"><span className="trace-kv-k">Latency</span><span className="trace-kv-v">{step.latency_ms}ms</span></div>
            </div>
          )}
          {step.type === 'final_response' && (
            <div className="trace-kv">
              <div className="trace-kv-row"><span className="trace-kv-k">Total ms</span><span className="trace-kv-v">{step.latency_ms}ms</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Ticket detail ─────────────────────────────────────────────────

function TicketDetail({ ticket }) {
  const toolCalls = ticket.trace_log.filter(s => s.type === 'tool_call');
  const llmCalls  = ticket.trace_log.filter(s => s.type === 'llm_call');
  const totalIn   = llmCalls.reduce((s, c) => s + (c.input_tokens || 0), 0);
  const totalOut  = llmCalls.reduce((s, c) => s + (c.output_tokens || 0), 0);
  const totalMs   = ticket.trace_log.find(s => s.type === 'final_response')?.latency_ms
    || llmCalls.reduce((s, c) => s + (c.latency_ms || 0), 0);

  return (
    <div>
      {/* Header */}
      <div className="ticket-detail-header">
        <div style={{ flex: 1 }}>
          <div className="ticket-detail-title">{ticket.subject || 'Untitled request'}</div>
          <div className="ticket-detail-meta">
            {statusBadge(ticket.status, ticket.resolution)}
            {ticket.customer_name && (
              <span className="ticket-meta-item">
                <span className="ticket-meta-label">Customer:</span> {ticket.customer_name}
              </span>
            )}
            {ticket.order_id && (
              <span className="ticket-meta-item">
                <span className="ticket-meta-label">Order:</span>
                <code style={{ fontSize: 11 }}>{ticket.order_id}</code>
              </span>
            )}
            <span className="ticket-meta-item">
              <span className="ticket-meta-label">Opened:</span>
              {new Date(ticket.created_at).toLocaleString()}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--bg-border)', borderRadius: 'var(--r-sm)', padding: '6px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{llmCalls.length}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>LLM calls</div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--bg-border)', borderRadius: 'var(--r-sm)', padding: '6px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{toolCalls.length}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>tool calls</div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--bg-border)', borderRadius: 'var(--r-sm)', padding: '6px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{totalIn + totalOut}</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>tokens</div>
          </div>
        </div>
      </div>

      <div className="ticket-detail-body">
        {/* Conversation */}
        <div>
          <div className="section-title">Conversation ({ticket.messages.length} messages)</div>
          <div className="conv-thread">
            {ticket.messages.map((m, i) => (
              <div key={i} className={`conv-msg ${m.role}`}>
                <div className="conv-avatar">{m.role === 'user' ? '👤' : '🤖'}</div>
                <div style={{ maxWidth: '72%' }}>
                  <div className="conv-bubble">{m.content}</div>
                  <div className="conv-time">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        {ticket.summary && (
          <div>
            <div className="section-title">Resolution summary</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--bg-border)', borderRadius: 'var(--r-sm)', padding: '12px 14px', fontSize: 13, color: 'var(--text-2)', lineHeight: 1.65 }}>
              {ticket.summary}
            </div>
          </div>
        )}

        {/* Reasoning trace */}
        {ticket.trace_log.length > 0 && (
          <div>
            <div className="section-title">
              Agent reasoning trace
              <span style={{ fontSize: 10.5, color: 'var(--text-3)', textTransform: 'none', fontWeight: 400, letterSpacing: 0 }}>
                {ticket.trace_log.length} steps · {totalMs}ms total
              </span>
            </div>
            <div className="trace-steps">
              {ticket.trace_log.map((step, i) => <TraceStep key={i} step={step} idx={i} />)}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 16 }}>
              <span>↑ {totalIn} input · ↓ {totalOut} output tokens</span>
              <span>Est. cost: ${((totalIn * 0.000000075) + (totalOut * 0.0000003)).toFixed(5)} (Gemini 2.5 Flash)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stats tab ────────────────────────────────────────────────────

function StatsTab({ token }) {
  const [stats, setStats]       = useState(null);
  const [policy, setPolicy]     = useState(null);
  const [customers, setCustomers] = useState(null);
  const [tab, setTab]           = useState('overview');

  useEffect(() => {
    fetch(`${API}/api/admin/stats`, { headers: authHeaders(token) })
      .then(r => r.json()).then(setStats).catch(console.error);
  }, [token]);

  const loadPolicy = () => {
    if (policy) return;
    fetch(`${API}/api/admin/policy`, { headers: authHeaders(token) })
      .then(r => r.json()).then(d => setPolicy(d.policy)).catch(console.error);
  };

  const loadCustomers = () => {
    if (customers) return;
    fetch(`${API}/api/admin/customers`, { headers: authHeaders(token) })
      .then(r => r.json()).then(d => setCustomers(d.customers)).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ borderBottom: '1px solid var(--bg-border)', padding: '0 24px', display: 'flex', gap: 2, flexShrink: 0 }}>
        {[['overview', 'Overview'], ['crm', 'CRM Customers'], ['policy', 'Refund Policy']].map(([k, v]) => (
          <button key={k} className={`admin-nav-btn ${tab === k ? 'active' : ''}`}
            onClick={() => { setTab(k); if (k === 'crm') loadCustomers(); if (k === 'policy') loadPolicy(); }}>
            {v}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {tab === 'overview' && stats && (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-label">Total tickets</div>
                <div className="stat-val">{stats.total_tickets}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Active</div>
                <div className="stat-val" style={{ color: 'var(--accent)' }}>{stats.in_progress}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Escalated</div>
                <div className="stat-val" style={{ color: 'var(--yellow)' }}>{stats.escalated}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Approved</div>
                <div className="stat-val" style={{ color: 'var(--green)' }}>{stats.by_resolution?.approved || 0}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Denied</div>
                <div className="stat-val" style={{ color: 'var(--red)' }}>{stats.by_resolution?.denied || 0}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Tool calls</div>
                <div className="stat-val">{stats.total_tool_calls}</div>
                <div className="stat-sub">across {stats.total_trace_steps} trace steps</div>
              </div>
            </div>
          </>
        )}
        {tab === 'overview' && !stats && <div className="empty-state"><div className="empty-icon">⏳</div>Loading stats…</div>}

        {tab === 'crm' && !customers && <div className="empty-state"><div className="empty-icon">⏳</div>Loading customers…</div>}
        {tab === 'crm' && customers && (
          <table className="crm-table">
            <thead>
              <tr><th>ID</th><th>Name</th><th>Email</th><th>Tier</th><th>Status</th><th>Orders</th></tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.customer_id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{c.customer_id}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text-1)' }}>{c.name}</td>
                  <td>{c.email}</td>
                  <td><span className={`tier-${c.membership_tier}`}>{c.membership_tier}</span></td>
                  <td><span className={`acct-${c.account_status}`}>{c.account_status}</span></td>
                  <td>{c.order_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'policy' && !policy && <div className="empty-state"><div className="empty-icon">⏳</div>Loading policy…</div>}
        {tab === 'policy' && policy && <pre className="policy-pre">{policy}</pre>}
      </div>
    </div>
  );
}

// ── AdminShell (main) ─────────────────────────────────────────────

export default function AdminShell({ token, onLogout }) {
  const [activeNav, setActiveNav]       = useState('tickets');
  const [tickets, setTickets]           = useState([]);
  const [selectedId, setSelectedId]     = useState(null);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [loadingDetail, setLoadingDetail]   = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true);
    try {
      const r = await fetch(`${API}/api/admin/tickets`, { headers: authHeaders(token) });
      if (r.status === 401) { onLogout(); return; }
      const d = await r.json();
      setTickets(d.tickets || []);
    } catch {}
    setLoadingTickets(false);
  }, [token, onLogout]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(fetchTickets, 15000);
    return () => clearInterval(id);
  }, [fetchTickets]);

  const selectTicket = async (tid) => {
    setSelectedId(tid);
    setLoadingDetail(true);
    try {
      const r = await fetch(`${API}/api/admin/tickets/${tid}`, { headers: authHeaders(token) });
      const d = await r.json();
      setSelectedTicket(d);
    } catch {}
    setLoadingDetail(false);
  };

  const handleLogout = async () => {
    try { await fetch(`${API}/api/admin/logout`, { method: 'POST', headers: authHeaders(token) }); } catch {}
    onLogout();
  };

  return (
    <div className="admin-shell">
      {/* Header */}
      <header className="admin-header">
        <div className="admin-header-left">
          <div className="brand">
            <span className="brand-logo">↩</span>
            <span className="brand-name">Loopp</span>
          </div>
          <span className="admin-badge">Admin</span>
          <nav className="admin-nav" style={{ marginLeft: 8 }}>
            <button className={`admin-nav-btn ${activeNav === 'tickets' ? 'active' : ''}`} onClick={() => setActiveNav('tickets')}>
              🎫 Tickets
            </button>
            <button className={`admin-nav-btn ${activeNav === 'stats' ? 'active' : ''}`} onClick={() => setActiveNav('stats')}>
              📊 Stats & Data
            </button>
          </nav>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-ghost" style={{ fontSize: 11 }} onClick={fetchTickets}>↻ Refresh</button>
          <button className="btn-danger" style={{ fontSize: 11 }} onClick={handleLogout}>Sign out</button>
        </div>
      </header>

      {/* Body */}
      <div className="admin-body">
        {activeNav === 'tickets' && (
          <>
            {/* Ticket list */}
            <div className="ticket-list-panel">
              <div className="panel-header">
                <h3>Support Tickets</h3>
                <span className="panel-count">{tickets.length}</span>
              </div>
              <div className="ticket-list">
                {loadingTickets && tickets.length === 0 && (
                  <div className="empty-state" style={{ padding: 40 }}><div className="empty-icon">⏳</div>Loading…</div>
                )}
                {!loadingTickets && tickets.length === 0 && (
                  <div className="empty-state" style={{ padding: 40 }}>
                    <div className="empty-icon">📭</div>
                    No tickets yet.<br />Customer interactions will appear here.
                  </div>
                )}
                {tickets.map(t => (
                  <div
                    key={t.ticket_id}
                    className={`ticket-item ${selectedId === t.ticket_id ? 'selected' : ''}`}
                    onClick={() => selectTicket(t.ticket_id)}
                  >
                    <div className="ticket-item-header">
                      <span className="ticket-item-id">{t.ticket_id}</span>
                      <span className="ticket-item-time">{timeAgo(t.updated_at)}</span>
                    </div>
                    <div className="ticket-item-subject">{t.subject || 'No subject'}</div>
                    <div className="ticket-item-meta">
                      {statusBadge(t.status, t.resolution)}
                      {t.customer_name && <span className="ticket-item-customer">· {t.customer_name}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Ticket detail */}
            <div className="ticket-detail-panel">
              {!selectedId && (
                <div className="ticket-detail-empty">
                  <span style={{ fontSize: 32 }}>🎫</span>
                  Select a ticket to view conversation and agent trace
                </div>
              )}
              {selectedId && loadingDetail && (
                <div className="ticket-detail-empty"><span style={{ fontSize: 32 }}>⏳</span>Loading…</div>
              )}
              {selectedId && !loadingDetail && selectedTicket && (
                <TicketDetail ticket={selectedTicket} />
              )}
            </div>
          </>
        )}

        {activeNav === 'stats' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <StatsTab token={token} />
          </div>
        )}
      </div>
    </div>
  );
}
