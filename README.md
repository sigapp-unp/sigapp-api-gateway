# sigapp-api-gateway

A secure Cloudflare Worker that acts as a gateway between the frontend the Supabase backend.

## 🧠 Purpose

- **Protect your Supabase service_role key** by keeping it server-side only.
- **Validate JWTs locally** using Supabase's public JWKs — no extra API call to `/auth/user`.
- **Enforce a clean architecture**: frontend sends access_tokens, Worker handles identity and talks to Supabase.
- **Avoid using RLS** (Row Level Security) by centralizing access control in the Worker.
- **Act as API Gateway** for multiple services (Supabase, OpenAI, etc.) with unified authentication.

## 🚀 How it works

```txt
[Client] → sends access_token + X-Upstream → [Worker] → validates JWT → forwards to appropriate service
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

Please do not end SUPABASE_URL in '/'

```bash
npm install
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put OPENAI_API_KEY
```

### 🔐 Configuración de Upstreams

```json
{
	"supabase": {
		"baseUrl": "${SUPABASE_URL}/rest/v1",
		"headers": {
			"apikey": "${SUPABASE_SERVICE_ROLE_KEY}",
			"Authorization": "Bearer ${SUPABASE_SERVICE_ROLE_KEY}",
			"Prefer": "'return=representation'"
		}
	},
	"openai": {
		"baseUrl": "https://api.openai.com/v1",
		"headers": {
			"Authorization": "Bearer ${OPENAI_API_KEY}"
		}
	}
}
```

### Notas importantes:

1. Los placeholders `${VARIABLE}` serán reemplazados por el valor de la variable de entorno correspondiente.

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

### `ANY /auth/*`

Proxies directly to Supabase Auth API:

- All requests to `/auth/*` are proxied to the corresponding Supabase Auth API endpoints
- Maintains Supabase's authentication API structure
- Examples:
  - `/auth/v1/signup` → Supabase signup endpoint
  - `/auth/v1/token?grant_type=password` → Login endpoint
  - `/auth/v1/token?grant_type=refresh_token` → Token refresh endpoint

### `ANY /rest/v1/...`

Protected route:

- Requires `Authorization: Bearer <access_token>`
- Validates JWT locally (via JWK)
- Forwards request to Supabase with `service_role`

### `ANY /<any-route>`

Con el header `X-Upstream`:

- Requiere `Authorization: Bearer <access_token>`
- Requiere `X-Upstream: <nombre-del-upstream>` (ej: `openai`, `github`, etc.)
- Valida JWT localmente
- Reenvía la petición al servicio apropiado con las credenciales configuradas

## 📱 Uso desde el frontend (ejemplos)

### Supabase (modo tradicional)

```http
GET /rest/v1/messages?user_id=eq.abc
Authorization: Bearer <your-access-token>
```

### OpenAI (como upstream)

```http
POST /chat/completions
Authorization: Bearer <your-access-token>
X-Upstream: openai
Content-Type: application/json

{
  "model": "gpt-4",
  "messages": [{"role": "user", "content": "Hello!"}]
}
```

### GitHub API (como upstream)

```http
GET /repos/usuario/repositorio/issues
Authorization: Bearer <your-access-token>
X-Upstream: github
```

---

Stay minimal. Stay sovereign.
The Worker is your border — **protect it accordingly**.
