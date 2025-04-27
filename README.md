# sigapp-api-gateway

A secure Cloudflare Worker that acts as a gateway between the frontend and various backend services, including Supabase.

## 🧠 Purpose

- **Protect your API keys and secrets** by keeping them server-side only (Supabase service_role key, OpenAI API key, etc.).
- **Validate JWTs locally** using both Supabase JWT secret and public JWKs — no extra API call to `/auth/user`.
- **Enforce a clean architecture**: frontend sends access_tokens, Worker handles identity and talks to backend services.
- **Avoid using RLS** (Row Level Security) by centralizing access control in the Worker.
- **Act as API Gateway** for multiple services (Supabase, OpenAI, etc.) with unified authentication.
- **Dynamic credential injection** via environment variables rather than hardcoded configuration.

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

Please do not end SUPABASE_URL with a trailing '/'

```bash
npm install
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put OPENAI_API_KEY
# Add additional API keys for other services as needed
```

### 🔐 Upstream Services Configuration

The gateway uses an `upstreamServices` configuration object that defines available services. The system automatically injects credentials from environment variables at runtime using placeholders:

```typescript
export const upstreamServices = {
	supabase: {
		baseUrl: '${SUPABASE_URL}/rest/v1',
		headers: {
			apikey: '${SUPABASE_SERVICE_ROLE_KEY}',
			Authorization: 'Bearer ${SUPABASE_SERVICE_ROLE_KEY}',
			Prefer: 'return=representation',
		},
	},
	openai: {
		baseUrl: 'https://api.openai.com/v1',
		headers: {
			Authorization: 'Bearer ${OPENAI_API_KEY}',
		},
	},
	// Add additional upstream services as needed
};
```

### Important notes:

1. The placeholders `${VARIABLE}` will be replaced with the corresponding environment variable values at runtime.
2. This approach keeps sensitive credentials separate from the configuration code.
3. To add a new upstream service, add a new entry to the `upstreamServices` object and set the required environment variables.

## 🔐 Security Features

- **Two-stage JWT validation**:
  - Primary: Validates using `SUPABASE_JWT_SECRET` (shared secret)
  - Secondary: Falls back to JWK validation (public key from Supabase)
- **Safe credential handling**: API keys stored as isolated environment secrets
- **Secure routing**: `X-Upstream` only allows predefined service routes

## 🧪 Local testing

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

### `ANY /<any-route>`

With the `X-Upstream` header:

- Requires `Authorization: Bearer <access_token>`
- Requires `X-Upstream: <upstream-name>` (e.g., `supabase`, `openai`, etc.)
- Validates JWT locally (using both methods)
- Forwards request to the appropriate service with configured credentials
- Preserves HTTP method and request body

## 📱 Client Usage Examples

### Supabase REST API (as upstream)

```http
GET /items?user_id=eq.abc
Authorization: Bearer <your-access-token>
X-Upstream: supabase
```

### OpenAI (as upstream)

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

### Adding New Upstream Services

1. Add the service configuration to `upstreamServices` in `src/config/proxy.ts`
2. Set any required API keys or secrets as environment variables
3. Deploy the worker with the updated configuration

---

For more details on the architecture, refer to the [architecture.md](./docs/architecture.md) document.

Stay minimal. Stay sovereign.
The Worker is your border — **protect it accordingly**.
