# sigapp-api-gateway

A secure Cloudflare Worker that acts as a gateway between your frontend (e.g., Flutter) and your Supabase backend.

## 🧠 Purpose

- **Protect your Supabase service_role key** by keeping it server-side only.
- **Validate JWTs locally** using Supabase's public JWKs — no extra API call to `/auth/user`.
- **Enforce a clean architecture**: frontend sends access_tokens, Worker handles identity and talks to Supabase.
- **Avoid using RLS** (Row Level Security) by centralizing access control in the Worker.

## 🚀 How it works

```
[Client] → sends access_token → [Worker] → validates JWT → forwards to Supabase using service_role
```

## 🏗️ Creation

```bash
npm install -g wrangler
wrangler login
npm create cloudflare@latest

# Set subdomain
# Enable subdomain for this worker from dashboard

# Set types

wrangler types
npm uninstall @cloudflare/workers-types
# then remove "types" from tsconfig.json
# and replace '"types": ["@cloudflare/vitest-pool-workers"]' by '"types": ["@cloudflare/vitest-pool-workers"]'
npm run cf-typegen # Verify
```

## ⚙️ Setup

```bash
npm install
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
```

## 🧪 Local test

```bash

# Remote mode (requires workers.dev subdomain)
wrangler dev --remote --ip 0.0.0.0

# Or use local mode
wrangler dev
```

## 🚢 Deploy

```bash
wrangler deploy
```

## 📦 Endpoints

### `POST /auth/signup`

Proxies to Supabase `/auth/v1/signup`

### `POST /auth/login`

Proxies to `/auth/v1/token?grant_type=password`

### `POST /auth/refresh`

Proxies to `/auth/v1/token?grant_type=refresh_token`

### `ANY /rest/v1/...`

Protected route:

- Requires `Authorization: Bearer <access_token>`
- Validates JWT locally (via JWK)
- Forwards request to Supabase with `service_role`

## 📱 Usage from frontend (example)

```http
GET /rest/v1/messages?user_id=eq.abc
Authorization: Bearer <your-access-token>
```

---

Stay minimal. Stay sovereign.
The Worker is your border — **protect it accordingly**.
