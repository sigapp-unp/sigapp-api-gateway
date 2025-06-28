# sigapp-api-gateway

A secure Cloudflare Worker that acts as a gateway between the frontend and various backend services, including Supabase.

## 🧠 Purpose

- **Protect your API keys and secrets** by keeping them server-side only (Supabase service_role key, OpenAI API key, etc.).
- **Validate JWTs locally** using both Supabase JWT secret and public JWKs — no extra API call to `/auth/user`.
- **Enforce a clean architecture**: frontend sends access_tokens, Worker handles identity and talks to backend services.
- **Avoid using RLS** (Row Level Security) by centralizing access control in the Worker.
- **Act as API Gateway** for multiple services (Supabase, OpenAI, etc.) with unified authentication.
- **Dynamic credential injection** via environment variables rather than hardcoded configuration.

## 🏗️ Architecture

### **Routing Flow**

```txt
[Request] → index.ts → Route Decision:
                    ├── /tools/*     → handleToolsRoute()     → Custom tools
                    ├── /auth/*      → handleAuthRoute()      → Supabase Auth
                    └── /*           → handleUpstreamRoute()  → Service Gateway
```

### **Module Separation**

- **🔧 `/tools/*`**: Custom academic functionality (password reset, validation)
- **🔐 `/auth/*`**: Pure Supabase Auth proxy (no custom logic)
- **🌐 `/*`**: General service gateway with X-Upstream routing

This architecture ensures:

- Clean separation of concerns
- Easy addition of new tools
- Supabase auth remains untouched
- Scalable for future academic features

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

## ⚙️ Setup & Configuration

### 🔧 **Variables de Entorno**

**Variables requeridas:**

- `SUPABASE_URL` - URL de tu proyecto Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key de Supabase
- `SUPABASE_ANON_KEY` - Anon key de Supabase
- `SUPABASE_JWT_SECRET` - JWT secret de Supabase
- `OPENAI_API_KEY` - API key de OpenAI

**Configuración por ambiente:**

- **Local** (`wrangler dev --ip 0.0.0.0`): Archivo `.dev.vars`
- **Remoto** (`wrangler dev --remote` / `wrangler deploy`): Cloudflare secrets via `wrangler secret put`

**Scripts automáticos para secrets remotos:**

- Linux/Mac: `./secrets/put.bash` (lee `secrets/secrets.env`)
- Windows: `.\secrets\put.ps1` (lee `secrets/secrets.env`)

### 📋 **Verificación**

```bash
wrangler secret list  # Ver secrets configurados
wrangler whoami      # Ver cuenta actual

# Ver configuración del worker
cat wrangler.toml
```

### ⚠️ **Notas Importantes**

- `.dev.vars` es solo para desarrollo local (agregar a `.gitignore`)
- `SUPABASE_URL` NO debe terminar con `/`
- Secrets remotos se comparten entre `--remote` y `deploy`
- Los cambios en secrets se aplican inmediatamente sin redeploy

**Errores comunes:**

- "Missing environment variables" → `wrangler secret list`
- Worker local funciona pero remoto falla → configurar secrets remotos
- CORS/401 errors → verificar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`

## Important concepts

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

## 🧪 Testing & Deployment

### **Comandos y Modos de Desarrollo**

| Comando                              | Dónde Ejecuta    | Variables       | Acceso                | Cuándo Usar                                      |
| ------------------------------------ | ---------------- | --------------- | --------------------- | ------------------------------------------------ |
| `wrangler dev --ip 0.0.0.0`          | Tu máquina local | `.dev.vars`     | Red local + localhost | Desarrollo con clientes externos (Flutter, etc.) |
| `wrangler dev --remote --ip 0.0.0.0` | Cloudflare Edge  | Secrets remotos | Internet público      | Testing en ambiente real                         |
| `wrangler deploy`                    | Cloudflare Edge  | Secrets remotos | Internet público      | Deploy a producción                              |

**Comandos recomendados:**

- **Desarrollo local**: `wrangler dev --ip 0.0.0.0` (accesible desde red local para Flutter/móviles)
- **Testing remoto**: `wrangler dev --remote --ip 0.0.0.0` (ambiente real de Cloudflare)
- **Producción**: `wrangler deploy` (deploy permanente)

**💡 Ventajas del modo local con `--ip 0.0.0.0`:**

Permite acceso desde múltiples interfaces de red:

- `http://127.0.0.1:8787` - Localhost tradicional
- `http://192.168.x.x:8787` - Tu IP en la red local (ideal para Flutter/móviles)
- `http://172.x.x.x:8787` - Otras interfaces de red (Docker, WSL, etc.)

Esto es especialmente útil para:

- Aplicaciones Flutter que necesitan conectarse desde dispositivos móviles
- Testing desde otros dispositivos en tu red local
- Desarrollo colaborativo en la misma red

## 📦 Endpoints

### `ANY /auth/*` - Supabase Auth Proxy

Proxies directly to Supabase Auth API:

- All requests to `/auth/*` are proxied to the corresponding Supabase Auth API endpoints
- Maintains Supabase's authentication API structure
- Examples:
  - `/auth/v1/signup` → Supabase signup endpoint
  - `/auth/v1/token?grant_type=password` → Login endpoint
  - `/auth/v1/token?grant_type=refresh_token` → Token refresh endpoint

### `POST /tools/*` - Custom Academic Tools 🆕

Custom functionality for academic validation and user management:

#### **`POST /tools/password-reset`**

Secure password reset with academic validation:

```http
POST /tools/password-reset
Content-Type: application/json

{
  "academicUsername": "0812024054",
  "academicPassword": "student_password"
}
```

**Flow:**

1. 🔍 Looks up user by email: `{academicUsername}@sigapp.dev`
2. ✅ Validates credentials against UNP academic system
3. 🔄 Updates password in Supabase if validation succeeds

**Response codes:**

- `200`: Password updated successfully
- `400`: Invalid request format
- `401`: Academic credentials invalid
- `404`: User not found in Supabase
- `500`: Server or validation error

### `ANY /<any-route>` - Service Gateway

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

## TODO

- [ ] Separar db prod de db dev, al menos de manera más fácil de configurar en ambientes
- [ ] Considerar dejar de usar .env o al menos aumentar validaciones y restricciones estandarizadas

---

For more details on the architecture, refer to the [architecture.md](./docs/architecture.md) document.

Stay minimal. Stay sovereign.
The Worker is your border — **protect it accordingly**.
