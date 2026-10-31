'use client';

import { FormEvent, useEffect, useState } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type Provider = 'auto' | 'openai' | 'anthropic' | 'gemini';

type User = {
  id: string;
  email: string;
};

type Conversation = {
  id: string;
  title: string;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<Provider>('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadConversations() {
    const response = await fetch('/api/conversations');

    if (!response.ok) {
      throw new Error('Could not load conversations.');
    }

    const data = await response.json();
    setConversations(data.conversations || []);
  }

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch('/api/auth/me');

        if (!response.ok) {
          throw new Error('Could not check your session.');
        }

        const data = await response.json();

        setUser(data.user || null);

        if (data.user) {
          await loadConversations();
        }
      } catch (err) {
        console.error('Session check failed:', err);
      } finally {
        setAuthReady(true);
      }
    }

    checkSession();
  }, []);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authBusy) return;

    setAuthError('');
    setAuthBusy(true);

    try {
      const response = await fetch(
        register ? '/api/auth/register' : '/api/auth/login',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            password,
          }),
        }
      );

      const text = await response.text();

      let data: {
        user?: User;
        error?: string;
      };

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          'The server returned an invalid response. Check Render logs.'
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error || `Authentication failed (${response.status}).`
        );
      }

      if (!data.user) {
        throw new Error('Authentication succeeded but no user was returned.');
      }

      setUser(data.user);
      setPassword('');
      setAuthError('');

      await loadConversations();
    } catch (err) {
      console.error('Authentication error:', err);

      setAuthError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function openConversation(id: string) {
    setError('');

    try {
      const response = await fetch(`/api/conversations/${id}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Could not open conversation.');
      }

      setConversationId(id);

      setMessages(
        data.conversation.messages.map((message: Message) => ({
          role: message.role,
          content: message.content,
        }))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not open conversation.'
      );
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();

    if (!text || busy) return;

    const next = [
      ...messages,
      {
        role: 'user' as const,
        content: text,
      },
    ];

    setMessages(next);
    setInput('');
    setError('');
    setBusy(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: next,
          provider,
          conversationId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'The request failed.');
      }

      setConversationId(data.conversationId);

      setMessages([
        ...next,
        {
          role: 'assistant',
          content: data.reply,
        },
      ]);

      await loadConversations();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      setUser(null);
      setMessages([]);
      setConversations([]);
      setConversationId(undefined);
      setInput('');
    }
  }

  function newChat() {
    setMessages([]);
    setConversationId(undefined);
    setError('');
  }

  if (!authReady) {
    return (
      <main className="auth-shell">
        <div className="auth-card">Loading BMS AI…</div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <form className="auth-card" onSubmit={authenticate}>
          <div className="brand auth-brand">
            <span className="brand-mark">B</span>
            <span>
              BMS <b>AI</b>
            </span>
          </div>

          <p className="eyebrow">YOUR AI WORKSPACE</p>

          <h1>
            {register ? 'Create your account' : 'Welcome back'}
          </h1>

          <p className="auth-sub">
            Sign in to access your BMS AI workspace and saved conversations.
          </p>

          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              autoComplete={
                register ? 'new-password' : 'current-password'
              }
              minLength={register ? 10 : 1}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {register && (
            <small className="auth-hint">
              Use at least 10 characters.
            </small>
          )}

          {authError && (
            <div className="error" role="alert">
              {authError}
            </div>
          )}

          <button
            className="auth-submit"
            type="submit"
            disabled={authBusy}
          >
            {authBusy
              ? 'Please wait...'
              : register
                ? 'Create account'
                : 'Sign in'}
          </button>

          <p className="auth-switch">
            {register
              ? 'Already have an account?'
              : 'New to BMS AI?'}

            <button
              type="button"
              disabled={authBusy}
              onClick={() => {
                setRegister(!register);
                setAuthError('');
              }}
            >
              {register ? 'Sign in' : 'Create account'}
            </button>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">B</span>
          <span>
            BMS <b>AI</b>
          </span>
        </div>

        <button className="new-chat" onClick={newChat}>
          ＋ New chat
        </button>

        <div className="side-label">WORKSPACE</div>

        <div className="side-item active">
          ✦ <span>AI Chat</span>
        </div>

        <div className="side-item muted">
          ▧ <span>Projects <small>Coming next</small></span>
        </div>

        <div className="side-item muted">
          ⌘ <span>Coding Studio <small>Coming next</small></span>
        </div>

        <div className="side-item muted">
          ⌕ <span>Research <small>Coming next</small></span>
        </div>

        <div className="side-label">RECENT CHATS</div>

        <div className="history-list">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              className={`history-item ${
                conversationId === conversation.id ? 'selected' : ''
              }`}
              onClick={() => openConversation(conversation.id)}
            >
              {conversation.title || 'New chat'}
            </button>
          ))}
        </div>

        <div className="side-bottom">
          <span>{user.email}</span>

          <button onClick={logout}>Sign out</button>

          <br />

          One intelligence.
          <br />
          Unlimited possibilities.
        </div>
      </aside>

      <section className="main">
        <header className="topbar">
          <div>
            <span className="status-dot" /> BMS AI{' '}
            <span className="badge">EARLY ACCESS</span>
          </div>

          <label className="model-picker">
            Model

            <select
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value as Provider)
              }
            >
              <option value="auto">Auto select</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Claude</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="orb">✦</div>

              <p className="eyebrow">YOUR AI WORKSPACE</p>

              <h1>
                What can we <span>create</span> today?
              </h1>

              <p className="subhead">
                Ask a question, explore an idea, or get help bringing a
                project to life.
              </p>

              <div className="suggestions">
                {[
                  'Explain a difficult concept simply',
                  'Help me plan a website',
                  'Review and improve my code',
                ].map((item) => (
                  <button
                    key={item}
                    onClick={() => setInput(item)}
                  >
                    {item}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((message, index) => (
                <article
                  className={`message ${message.role}`}
                  key={index}
                >
                  <div className="avatar">
                    {message.role === 'user' ? 'Y' : '✦'}
                  </div>

                  <div>
                    <div className="role-label">
                      {message.role === 'user' ? 'YOU' : 'BMS AI'}
                    </div>

                    <p>{message.content}</p>
                  </div>
                </article>
              ))}

              {busy && (
                <div className="thinking">
                  <span /> BMS AI is thinking…
                </div>
              )}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div className="error">{error}</div>}

          <form className="composer" onSubmit={sendMessage}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Message BMS AI…"
              rows={2}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey
                ) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />

            <div className="composer-footer">
              <span>
                AI can make mistakes. Verify important information.
              </span>

              <button
                disabled={busy || !input.trim()}
                aria-label="Send message"
              >
                {busy ? '…' : '↑'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
            }
