'use client';

import {
  FormEvent,
  useEffect,
  useState,
} from 'react';

import Markdown from './Markdown';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type Provider =
  | 'auto'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'openrouter';

type ThinkingMode =
  | 'fast'
  | 'thinking'
  | 'coding'
  | 'research';

type User = {
  id: string;
  email: string;
};

type Conversation = {
  id: string;
  title: string;
};

const MODES: {
  id: ThinkingMode;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: 'fast',
    label: 'Fast',
    icon: '⚡',
    description: 'Quick answers and everyday questions.',
  },
  {
    id: 'thinking',
    label: 'Deep Thinking',
    icon: '🧠',
    description: 'Deeper reasoning for difficult problems.',
  },
  {
    id: 'coding',
    label: 'Coding',
    icon: '⌘',
    description: 'Programming, debugging and code creation.',
  },
  {
    id: 'research',
    label: 'Research',
    icon: '⌕',
    description: 'Detailed analysis and research assistance.',
  },
];

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
  const [thinkingMode, setThinkingMode] =
    useState<ThinkingMode>('thinking');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  async function authenticate(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (authBusy) return;

    setAuthError('');
    setAuthBusy(true);

    try {
      const response = await fetch(
        register
          ? '/api/auth/register'
          : '/api/auth/login',
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
          'Invalid server response. Check Render logs.'
        );
      }

      if (!response.ok) {
        throw new Error(
          data.error ||
          `Authentication failed (${response.status}).`
        );
      }

      if (!data.user) {
        throw new Error('No user returned from server.');
      }

      setUser(data.user);
      setPassword('');
      setAuthError('');

      await loadConversations();

    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function openConversation(id: string) {
    setError('');

    try {
      const response = await fetch(
        `/api/conversations/${id}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || 'Could not open conversation.'
        );
      }

      setConversationId(id);

      setMessages(
        data.conversation.messages.map(
          (message: Message) => ({
            role: message.role,
            content: message.content,
          })
        )
      );

      setSidebarOpen(false);

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not open conversation.'
      );
    }
  }

  async function sendMessage(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const text = input.trim();

    if (!text || busy) return;

    const next: Message[] = [
      ...messages,
      {
        role: 'user',
        content: text,
      },
    ];

    setMessages(next);
    setInput('');
    setError('');
    setNotice('');
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
          thinkingMode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || 'The request failed.'
        );
      }

      setConversationId(data.conversationId);
      setNotice(data.notice || '');

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
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
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
    setInput('');
    setError('');
    setSidebarOpen(false);
  }

  const activeMode = MODES.find(
    mode => mode.id === thinkingMode
  )!;

  if (!authReady) {
    return (
      <main className="auth-shell">
        <div className="auth-card">
          Loading BMS AI…
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <form
          className="auth-card"
          onSubmit={authenticate}
        >
          <div className="brand auth-brand">
            <span className="brand-mark">B</span>

            <span>
              BMS <b>AI</b>
            </span>
          </div>

          <p className="eyebrow">
            YOUR AI WORKSPACE
          </p>

          <h1>
            {register
              ? 'Create your account'
              : 'Welcome back'}
          </h1>

          <p className="auth-sub">
            Sign in to access your BMS AI workspace
            and saved conversations.
          </p>

          <label>
            Email address

            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={event =>
                setEmail(event.target.value)
              }
            />
          </label>

          <label>
            Password

            <input
              type="password"
              autoComplete={
                register
                  ? 'new-password'
                  : 'current-password'
              }
              minLength={register ? 10 : 1}
              required
              value={password}
              onChange={event =>
                setPassword(event.target.value)
              }
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
              {register
                ? 'Sign in'
                : 'Create account'}
            </button>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="shell">

      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label="Close menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`sidebar ${
          sidebarOpen ? 'sidebar-open' : ''
        }`}
      >
        <div className="brand">
          <span className="brand-mark">B</span>

          <span>
            BMS <b>AI</b>
          </span>
        </div>

        <button
          className="new-chat"
          onClick={newChat}
        >
          ＋ New chat
        </button>

        <div className="side-label">
          WORKSPACE
        </div>

        <div className="side-item active">
          ✦ <span>AI Chat</span>
        </div>

        <div className="side-item">
          ▧ <span>Projects</span>
        </div>

        <div className="side-item">
          ⌘ <span>Coding Studio</span>
        </div>

        <div className="side-item">
          ⌕ <span>Research</span>
        </div>

        <div className="side-label">
          RECENT CHATS
        </div>

        <div className="history-list">
          {conversations.map(conversation => (
            <button
              key={conversation.id}
              className={`history-item ${
                conversationId === conversation.id
                  ? 'selected'
                  : ''
              }`}
              onClick={() =>
                openConversation(conversation.id)
              }
            >
              {conversation.title || 'New chat'}
            </button>
          ))}
        </div>

        <div className="side-bottom">
          <span>{user.email}</span>

          <button onClick={logout}>
            Sign out
          </button>

          <br />

          One intelligence.
          <br />

          Unlimited possibilities.
        </div>
      </aside>

      <section className="main">

        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() =>
              setSidebarOpen(!sidebarOpen)
            }
          >
            ☰
          </button>

          <div>
            <span className="status-dot" />

            BMS AI

            <span className="badge">
              EARLY ACCESS
            </span>
          </div>

          <label className="model-picker">
            Model

            <select
              value={provider}
              onChange={event =>
                setProvider(
                  event.target.value as Provider
                )
              }
            >
              <option value="auto">
                Auto select
              </option>

              <option value="gemini">
                Gemini
              </option>

              <option value="groq">
                Groq
              </option>

              <option value="openrouter">
                OpenRouter
              </option>

              <option value="openai">
                OpenAI
              </option>

              <option value="anthropic">
                Claude
              </option>
            </select>
          </label>
        </header>

        <div className="conversation">

          {messages.length === 0 ? (

            <div className="welcome">

              <div className="orb">
                ✦
              </div>

              <p className="eyebrow">
                YOUR AI WORKSPACE
              </p>

              <h1>
                What can we <span>create</span> today?
              </h1>

              <p className="subhead">
                Ask a question, explore an idea,
                or bring a project to life.
              </p>

              <div className="suggestions">

                {[
                  'Explain a difficult concept simply',
                  'Help me plan a website',
                  'Review and improve my code',
                ].map(item => (
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
                    {message.role === 'user'
                      ? 'Y'
                      : '✦'}
                  </div>

                  <div>
                    <div className="role-label">
                      {message.role === 'user'
                        ? 'YOU'
                        : 'BMS AI'}
                    </div>

                    {message.role === 'user' ? (
                      <p>{message.content}</p>
                    ) : (
                      <Markdown text={message.content} />
                    )}
                  </div>

                </article>

              ))}

              {busy && (
                <div className="thinking">
                  <span />
                  BMS AI is working in{' '}
                  {activeMode.label} mode…
                </div>
              )}

            </div>

          )}

        </div>

        <div className="composer-wrap">

          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}

          {notice && !error && (
            <div
              role="status"
              style={{ fontSize: 13, opacity: 0.75, padding: '0 4px 8px' }}
            >
              {notice}
            </div>
          )}

          <div className="mode-bar">

            <div className="mode-title">
              AI MODE
            </div>

            <div className="mode-options">

              {MODES.map(mode => (

                <button
                  key={mode.id}
                  type="button"
                  className={`mode-button ${
                    thinkingMode === mode.id
                      ? 'mode-active'
                      : ''
                  }`}
                  onClick={() =>
                    setThinkingMode(mode.id)
                  }
                  title={mode.description}
                  disabled={busy}
                >
                  <span>{mode.icon}</span>
                  {mode.label}
                </button>

              ))}

            </div>

            <div className="mode-description">
              {activeMode.description}
            </div>

          </div>

          <form
            className="composer"
            onSubmit={sendMessage}
          >

            <textarea
              value={input}
              onChange={event =>
                setInput(event.target.value)
              }
              placeholder="Message BMS AI…"
              rows={2}
              disabled={busy}
              onKeyDown={event => {
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
                AI can make mistakes.
                Verify important information.
              </span>

              <button
                type="submit"
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
