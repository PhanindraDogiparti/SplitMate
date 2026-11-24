# SplitMate API

The Express API stores groups, members, expenses, expense splits, and settlements in Turso using libSQL. The API intentionally has no authentication, matching the current app setup; do not expose it to untrusted users without adding access control.

## Configure and run

1. Copy `.env.example` to `.env`.
2. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from your Turso database.
3. Install and start the service:

   ```sh
   npm install
   npm run dev
   ```

The service listens on port `5001` by default, matching the Vite development proxy. The database tables and indexes are initialized at startup. `TURSO_AUTH_TOKEN` is required for remote databases. For local development only, `TURSO_DATABASE_URL=file:./splitmate.db` can be used without a token.

### Email delivery

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in `.env` to enable email OTP delivery. For Gmail, use the sender's full Gmail address and a Google App Password (not the normal account password); port `587` uses STARTTLS. Use the same authorized sender address for `SMTP_FROM`. Never commit real SMTP credentials.

## Endpoints

- `GET /api/v1/health` — checks database connectivity.
- `GET /api/v1/groups` — lists groups and their member count/net balance.
- `POST /api/v1/groups` — creates a group and optional initial members.
- `GET /api/v1/groups/:groupId` — returns the group, members, expenses, and settlements.
- `POST /api/v1/groups/:groupId/members` — adds a member.
- `GET /api/v1/groups/:groupId/expenses` — lists expenses and splits.
- `POST /api/v1/groups/:groupId/expenses` — records an expense; omitted splits are divided evenly among the group members.
- `GET /api/v1/groups/:groupId/settlements` — lists settlements.
- `POST /api/v1/groups/:groupId/settlements` — records a payment against an outstanding member balance.

Request and response amounts are decimal currency units; the database stores integer minor units to avoid floating-point balance calculations. Groups default to INR. Authentication includes email OTP endpoints; `POST /api/v1/auth/request-otp` returns an error if SMTP delivery fails.
