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

### 🎯 **IMPORTANTE: Entender los 3 Ambientes**

Cloudflare Workers tiene **3 modos diferentes** que usan **configuraciones diferentes**:

| Comando                 | Ambiente            | Variables             | URL                     | Propósito         |
| ----------------------- | ------------------- | --------------------- | ----------------------- | ----------------- |
| `wrangler dev`          | **Local**           | `.dev.vars`           | `localhost:8787`        | Desarrollo rápido |
| `wrangler dev --remote` | **Remoto Temporal** | `wrangler secret put` | `*.workers.dev`         | Testing real      |
| `wrangler deploy`       | **Producción**      | `wrangler secret put` | `tu-worker.workers.dev` | Deploy final      |

### 🔧 **Configuración por Ambiente**

#### **1. Desarrollo Local** 💻

Para `wrangler dev` (desarrollo local):

```bash
# Crear archivo .dev.vars (NO commitear a git)
echo "SUPABASE_URL=https://tu-proyecto.supabase.co" > .dev.vars
echo "SUPABASE_SERVICE_ROLE_KEY=eyJ..." >> .dev.vars
echo "SUPABASE_ANON_KEY=eyJ..." >> .dev.vars
echo "SUPABASE_JWT_SECRET=tu-jwt-secret" >> .dev.vars
echo "OPENAI_API_KEY=sk-..." >> .dev.vars

# Ejecutar localmente
wrangler dev
```

⚠️ **IMPORTANTE**: Agrega `.dev.vars` a tu `.gitignore`

#### **2. Remoto (Testing + Producción)** 🌐

Para `wrangler dev --remote` y `wrangler deploy`:

##### **Opción A: Manual** (Recomendado para seguridad)

```bash
# Configurar secrets uno por uno
wrangler secret put SUPABASE_URL
# Pegar: https://tu-proyecto.supabase.co

wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Pegar: eyJ...

wrangler secret put SUPABASE_ANON_KEY
# Pegar: eyJ...

wrangler secret put SUPABASE_JWT_SECRET
# Pegar: tu-jwt-secret

wrangler secret put OPENAI_API_KEY
# Pegar: sk-...
```

##### **Opción B: Script Automático** (⚠️ Cuidado con logs)

1. **Duplica `.env.example` como `secrets.env`** y configura tus valores:

```bash
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
SUPABASE_JWT_SECRET=tu-jwt-secret
OPENAI_API_KEY=sk-...
```

2. **Ejecuta el script**:

**Linux/Mac/WSL:**

```bash
while IFS='=' read -r key value; do
  if [ -n "$key" ] && [ -n "$value" ]; then
    echo "$value" | wrangler secret put "$key"
  fi
done < secrets.env
```

**Windows PowerShell:**

```powershell
Get-Content secrets.env | ForEach-Object {
  if ($_ -match '^([^=]+)=(.+)$') {
    $key = $matches[1].Trim()
    $value = $matches[2].Trim()
    $value | wrangler secret put $key
  }
}
```

### 📋 **Verificar Configuración**

```bash
# Ver secrets remotos configurados
wrangler secret list

# Ver tu cuenta actual
wrangler whoami

# Ver configuración del worker
cat wrangler.toml
```

### ⚠️ **Puntos Críticos del Equipo**

1. **`.dev.vars` es SOLO para desarrollo local** - nunca se sube a git
2. **`wrangler secret put` es para producción** - se guarda en Cloudflare
3. **Cambiar un secret afecta inmediatamente** al worker desplegado (sin redeploy)
4. **`--remote` y `deploy` comparten los mismos secrets**
5. **No terminar `SUPABASE_URL` con `/`** (muy importante)

### 🚨 **Troubleshooting Común**

**❌ Error: "Missing environment variables"**

- Revisa que tengas todos los secrets configurados: `wrangler secret list`

**❌ Error: Worker funciona local pero falla remoto**

- Probablemente faltan secrets remotos, configúralos con `wrangler secret put`

**❌ Error: CORS o 401 en requests**

- Verifica que `SUPABASE_URL` no termine con `/`
- Confirma que `SUPABASE_SERVICE_ROLE_KEY` sea el correcto

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

### **Comandos y Sus Diferencias**

| Comando                              | Dónde Ejecuta    | Variables       | Cuándo Usar                        |
| ------------------------------------ | ---------------- | --------------- | ---------------------------------- |
| `wrangler dev`                       | Tu máquina local | `.dev.vars`     | Desarrollo rápido, debugging       |
| `wrangler dev --remote --ip 0.0.0.0` | Cloudflare Edge  | Secrets remotos | Testing real, compartir con equipo |
| `wrangler deploy`                    | Cloudflare Edge  | Secrets remotos | Deploy a producción                |

### **1. Desarrollo Local** 💻

```bash
# Asegúrate de tener .dev.vars configurado
wrangler dev

# ✅ Ventajas:
# - Rápido reload
# - Debugging fácil
# - No consume quota de Cloudflare

# ❌ Limitaciones:
# - Solo accessible desde tu máquina
# - No usa secrets remotos
```

### **2. Testing Remoto** 🌐

```bash
# Testing en el edge real de Cloudflare
wrangler dev --remote --ip 0.0.0.0

# ✅ Ventajas:
# - Ambiente real de Cloudflare
# - URL pública para compartir con el equipo
# - Usa secrets remotos (como producción)
# - Testing de latencia real

# ⚠️ Notas:
# - Requiere secrets configurados con `wrangler secret put`
# - Consume quota de requests de Cloudflare
```

### **3. Deploy a Producción** 🚀

```bash
# Deploy permanente
wrangler deploy

# ✅ Resultado:
# - Worker disponible 24/7
# - URL estable para frontend
# - Usa secrets remotos configurados
```

### **Flujo Recomendado para el Equipo** �

1. **Desarrollo individual**: `wrangler dev` (cada dev con su `.dev.vars`)
2. **Testing colaborativo**: `wrangler dev --remote` (URL compartida)
3. **Deploy a staging/prod**: `wrangler deploy`

### **URLs Generadas**

```bash
# Local
wrangler dev
# → http://localhost:8787

# Remote testing
wrangler dev --remote --ip 0.0.0.0
# → https://sigapp-db-proxy.tu-usuario.workers.dev

# Production
wrangler deploy
# → https://sigapp-db-proxy.tu-usuario.workers.dev
```

**💡 Tip**: El `--ip 0.0.0.0` permite que otros en tu red local también accedan al worker remoto.

Example output:

```bash
$ wrangler deploy

 ⛅️ wrangler 4.12.0 (update available 4.13.2)
-------------------------------------------------------

Total Upload: 10.75 KiB / gzip: 3.17 KiB
No bindings found.
Uploaded sigapp-api-gateway (3.34 sec)
Deployed sigapp-api-gateway triggers (1.42 sec)
  https://sigapp-api-gateway.j-daniel-c-b.workers.dev
Current Version ID: dd190695-e8f3-43c3-a9d7-d9cd98ab477a
```

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

For more details on the architecture, refer to the [architecture.md](./docs/architecture.md) document.

Stay minimal. Stay sovereign.
The Worker is your border — **protect it accordingly**.
