# BMS AI — starter application

This is the **single starter codebase** for BMS AI. It is an early working foundation, not the finished super-platform.

## Included
- Responsive dark BMS AI chat interface.
- Manual provider choice: OpenAI, Anthropic Claude, or Google Gemini.
- Auto mode that selects the first configured provider in a deterministic order.
- Server-side provider API calls (keys are not exposed to the browser).
- Basic request validation and honest missing-key errors.

## Requirements
- Node.js 20.9 or newer.
- An API key for at least one provider.

## Run locally
1. Copy `.env.example` to `.env.local`.
2. Add one or more provider API keys.
3. Install dependencies: `npm install`
4. Start: `npm run dev`
5. Open `http://localhost:3000`

## Deploy
Deploy as a Next.js application on a Node-compatible host. Add provider keys as server-side environment variables in the hosting dashboard. Do not commit `.env.local`.

## Current limitations
- Conversations are held in browser memory only; database persistence is not implemented yet.
- Responses are currently returned as complete messages, not streamed.
- Auto routing is a simple configured-provider fallback order, not an evaluated intelligence router.
- There is no authentication, project storage, file upload, artifact sandbox, agent execution, or payment system yet.
- Provider model identifiers are starter defaults and should be checked against the provider's current model catalogue before production use.
- The initial API route needs production hardening: authentication, rate limiting, quotas, provider timeouts, robust error mapping, and audit logging.

## Next engineering milestone
Add authentication and PostgreSQL-backed conversations, then implement streaming and a provider/model capability registry.


## Database and accounts (new)
- PostgreSQL schema for users, conversations, and messages.
- Email/password registration and login.
- Password hashing with bcrypt.
- Signed, HTTP-only, seven-day session cookie.
- Conversation history stored per user.
- Ownership checks on conversation reads/deletes and chat writes.

### Setup database
1. Create a PostgreSQL database.
2. Set `DATABASE_URL` in `.env.local`.
3. Set `AUTH_SECRET` to a long random secret (32+ characters).
4. Run `npm install`.
5. Run `npm run db:push`.
6. Add at least one provider API key.
7. Run `npm run dev`.

### Important production work still required
This milestone is a development foundation, not a production security audit. Before public launch, add rate limiting and abuse protection to authentication and chat, email verification, password reset, CSRF/origin checks for state-changing endpoints, account deletion/export, session revocation, provider request timeouts, and monitoring. Configure database backups. Do not deploy publicly until these controls are completed and tested.
