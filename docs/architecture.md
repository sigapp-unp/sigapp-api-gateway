# 🧠 Arquitectura

\*\*Flutter + Cloudfla## 🎯 Arquitectura Modular (Nueva)

### **Separación de Responsabilidades**

El Worker ahora está organizado en **3 módulos independientes**:

| Módulo      | Ruta       | Responsabilidad                      | Autenticación   |
| ----------- | ---------- | ------------------------------------ | --------------- |
| **Tools**   | `/tools/*` | Herramientas académicas customizadas | ❌ Sin JWT      |
| **Auth**    | `/auth/*`  | Proxy puro a Supabase Auth           | ❌ Sin JWT      |
| **Gateway** | `/*`       | Routing a servicios externos         | ✅ Requiere JWT |

### **Módulo Tools** 🔧

**Propósito**: Funcionalidad académica específica del dominio universitario

```typescript
// Estructura del módulo
src/routes/tools.ts              → Router de herramientas
src/helpers/external-services.ts → Lógica de validación académica
```

**Endpoints disponibles**:

- `POST /tools/password-reset` → Reset de contraseña con validación UNP

**Flujo de Password Reset**:

1. 🔍 **Buscar usuario**: `{academicUsername}@sigapp.dev` → `userId` en Supabase
2. ✅ **Validar académico**: POST a `academico.unp.edu.pe` (requiere status 302)
3. 🔄 **Actualizar contraseña**: PUT a Supabase Admin API con service role

**Características**:

- ❌ **No requiere JWT**: Son herramientas administrativas internas
- 🔐 **Usa service role**: Acceso directo a Supabase Admin API
- 🎓 **Dominio académico**: Específico para validación contra sistema UNP
- 📈 **Escalable**: Fácil agregar más herramientas académicas

### **Módulo Auth** 🔐

**Propósito**: Proxy transparente a Supabase Auth (sin lógica custom)

```typescript
// Comportamiento
src/routes/auth.ts → Proxy puro, sin modificaciones
```

**Endpoints**:

- `POST /auth/v1/signup` → Registro en Supabase
- `POST /auth/v1/token` → Login/refresh tokens
- `GET /auth/v1/user` → Info del usuario autenticado
- `POST /auth/v1/logout` → Cerrar sesión

**Características**:

- 🔄 **Proxy transparente**: Forward directo a Supabase sin modificar
- ❌ **Sin lógica custom**: Mantiene comportamiento original de Supabase
- 🏗️ **Separación limpia**: Auth separado de herramientas custom

### **Módulo Gateway** 🌐

**Propósito**: Routing autenticado a servicios externos

```typescript
// Comportamiento original mantenido
src/routes/gateway.ts → X-Upstream routing con JWT validation
```

**Headers requeridos**:

- `Authorization: Bearer <jwt_token>`
- `X-Upstream: <service_name>`

**Servicios disponibles**:

- `X-Upstream: supabase` → Supabase REST API
- `X-Upstream: openai` → OpenAI API
- `X-Upstream: <other>` → Otros servicios configurados

---

## 🔑 Claves de la Nueva ArquitecturaWorker como API Gateway + Supabase Auth + Tools Académicos

con Validación JWT local y enrutamiento modular a múltiples servicios\*\*

---

## ⚙️ Componentes

| Elemento                  | Función                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| **Flutter**               | UI + manejador de sesión (`access_token`)                             |
| **Cloudflare Worker**     | API Gateway + verificador de identidad + herramientas académicas      |
| **Supabase Auth**         | Emisor de tokens JWT firmados                                         |
| **Supabase DB**           | Base de datos PostgreSQL, accedida vía REST, sin RLS                  |
| **Sistema Académico UNP** | Validación externa de credenciales académicas                         |
| **Servicios externos**    | OpenAI, servicios internos, etc. accedidos a través del Gateway       |
| **`X-Upstream`**          | Header que indica a qué servicio apuntar (`openai`, `supabase`, etc.) |

---

# 📐 Flujo General

```
[Flutter] → request según el tipo:
       ├── /tools/*     → Herramientas académicas (password reset, validación)
       ├── /auth/*      → Autenticación Supabase (login, signup, refresh)
       └── /*           → Gateway con JWT + X-Upstream → servicios externos
                    ↓
[Worker] → Router en index.ts decide el módulo:
       ├── handleToolsRoute()     → Custom academic tools
       ├── handleAuthRoute()      → Pure Supabase auth proxy
       └── handleUpstreamRoute()  → Service gateway con JWT validation
                    ↓
[Destino] ← responde según el flujo
```

---

# 🎯 Arquitectura Modular (Nueva)

## ✅ **1. El JWT se valida de dos formas**

- **Validación primaria**: Intenta verificar el token con `SUPABASE_JWT_SECRET` (secreto compartido)
- **Validación secundaria**: Si falla la primera, intenta con la clave pública JWK de Supabase (`/.well-known/jwks.json`)
- No se hace una llamada adicional al endpoint `/auth/v1/user` para validar cada solicitud
- Se usa la librería `jose` para validar la firma JWT
- Se cachea la JWK para mejorar el rendimiento

## ✅ **2. El Worker funciona como API Gateway**

- Único punto de validación de identidad mediante JWT de Supabase
- Enrutamiento dinámico a múltiples servicios externos mediante `X-Upstream`
- No expone claves API directamente al cliente (Flutter)
- Puede realizar validación adicional por usuario específico (claims en JWT)
- Mantiene compatibilidad con el flujo anterior para Supabase DB

## ✅ **3. Enrutamiento seguro con `upstreamServices`**

- `X-Upstream` no define directamente la URL de destino
- El Worker solo acepta valores predefinidos en la configuración
- Cada upstream puede tener sus propias cabeceras y restricciones
- Permite controlar precisamente quién puede acceder a cada servicio

## ✅ **4. Manejo seguro de credenciales**

- Las claves API se configuran como variables de entorno secretas (`OPENAI_API_KEY`, etc.)
- Se inyectan automáticamente en la configuración de upstreams en tiempo de ejecución
- Mantiene las credenciales fuera de la configuración de upstreamServices
- Mayor seguridad y facilidad de rotación de claves

---

# 🔐 ¿Por qué es seguro?

| Riesgo                        | Mitigación                                                            |
| ----------------------------- | --------------------------------------------------------------------- |
| Clave filtrada                | API Keys nunca están en el cliente                                    |
| Credenciales en configuración | Las claves se almacenan como secrets separados, no en JSON            |
| Session hijack (token robado) | JWT firmado, validado local, expira rápido                            |
| Acceso sin auth               | Worker niega cualquier request sin token válido                       |
| Bypass del Worker             | Servicios externos configurados para solo aceptar requests del Worker |
| `X-Upstream` malicioso        | Solo se permiten valores predefinidos en `upstreamServices`           |

---

# 📚 Flujo Detallado

## 🔸 1. Login, signup o refresh token (igual que antes)

```
POST https://tu-worker.workers.dev/auth/login
POST https://tu-worker.workers.dev/auth/signup
POST https://tu-worker.workers.dev/auth/refresh
```

El Worker reenvía estas solicitudes a Supabase Auth y devuelve los tokens.

## 🔸 2. Flutter guarda ese `access_token` (JWT)

Puede usar `flutter_secure_storage` o incluso memoria.

## 🔸 3. Flutter hace peticiones a cualquier servicio (vía Worker)

```
GET https://tu-worker.workers.dev/cualquier/ruta
Headers:
  Authorization: Bearer <access_token>
  X-Upstream: openai
  Content-Type: application/json
```

## 🔸 4. Worker valida el JWT (local)

- Primero intenta verificar con el secreto compartido
- Si falla, usa la clave pública JWK de Supabase
- Verifica la firma, expiración y otros claims

## 🔸 5. Worker verifica el `X-Upstream`

- Comprueba si el valor está en la configuración `upstreamServices`
- Verifica si el usuario tiene permisos para ese upstream según su ID
- Si no es válido, responde con error 400 o 403

## 🔸 6. Worker reenvía la request al servicio externo

```
POST https://api.openai.com/v1/cualquier/ruta
Headers:
  Authorization: Bearer sk-openai-key-secreta
  Content-Type: application/json
```

- Añade las cabeceras necesarias (API keys, tokens) según la configuración
- No reenvía el header Authorization original con el JWT de Supabase
- Mantiene el método HTTP y cuerpo de la solicitud original
- La respuesta del servicio externo se devuelve al cliente

---

# 🧠 Ventajas de este plan

| Ventaja                              | Por qué importa                                    |
| ------------------------------------ | -------------------------------------------------- |
| Reutilización del sistema Auth       | Una sola autenticación para todo                   |
| No exponer claves API en cliente     | Mayor seguridad, menos riesgo                      |
| Control centralizado de permisos     | Política de acceso unificada                       |
| Flexibilidad para conectar servicios | Fácil integración de nuevas APIs                   |
| Evolución natural del proxy          | Mantiene compatibilidad                            |
| Observabilidad centralizada          | Logs y métricas en un solo lugar                   |
| Gestión segura de credenciales       | Las claves API se mantienen como secretos aislados |

---

# ❌ Riesgos o desafíos

| Riesgo                           | Mitigación                                          |
| -------------------------------- | --------------------------------------------------- |
| Worker como punto único de fallo | Considerar redundancia y alta disponibilidad        |
| Latencia añadida                 | Optimizar código, usar caching adecuado             |
| Complejidad en configuración     | Documentar bien la estructura de `upstreamServices` |
| Límites de Cloudflare Workers    | Monitorizar uso de CPU y memoria                    |

---

## 🧰 Implementación Actual

### **1. Router Principal** (`src/index.ts`)

```typescript
// Routing modular basado en prefijo de ruta
if (requestUrl.pathname.startsWith('/tools/')) {
	return await handleToolsRoute({ requestUrl, request, jsonBody, supabaseConfig });
}
if (requestUrl.pathname.startsWith('/auth/')) {
	return await handleAuthRoute({ requestUrl, request, jsonBody, supabaseConfig });
}
return await handleUpstreamRoute({ request, requestUrl, jsonBody, env });
```

### **2. Configuración de Servicios Externos**

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
};
```

### **3. Configuración de Variables de Entorno**

#### **Desarrollo Local** (`.dev.vars`)

```bash
SUPABASE_URL=https://proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
SUPABASE_JWT_SECRET=secret...
OPENAI_API_KEY=sk-...
```

#### **Producción/Testing Remoto** (`wrangler secret put`)

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put OPENAI_API_KEY
```

### **4. Estructura de Archivos**

```
src/
├── index.ts                     # Router principal
├── routes/
│   ├── tools.ts                 # Herramientas académicas
│   ├── auth.ts                  # Proxy a Supabase Auth
│   └── gateway.ts               # Gateway con X-Upstream
├── helpers/
│   ├── external-services.ts     # Lógica de password reset
│   └── http.ts                  # Utilidades HTTP
├── config/
│   └── proxy.ts                 # Configuración upstreamServices
└── types.ts                     # Definiciones de tipos
```

### **5. Validación JWT (Módulo Gateway)**

```typescript
// Validación de dos etapas
try {
	// Primero: secreto compartido
	const payload = await jwtVerify(token, secret);
} catch {
	// Segundo: clave pública JWK
	const { payload } = await jwtVerify(token, JWKS);
}
```

### **6. Inyección Automática de Credenciales**

Las variables con formato `${VARIABLE}` se reemplazan automáticamente:

```typescript
// Configuración → Ejecución
'Bearer ${OPENAI_API_KEY}' → 'Bearer sk-abc123...'
'${SUPABASE_URL}/rest/v1' → 'https://proyecto.supabase.co/rest/v1'
```

---

## 🚀 Despliegue y Ambientes

### **Ambientes de Desarrollo**

| Comando                 | Ambiente        | Variables       | URL              | Uso               |
| ----------------------- | --------------- | --------------- | ---------------- | ----------------- |
| `wrangler dev`          | Local           | `.dev.vars`     | `localhost:8787` | Desarrollo rápido |
| `wrangler dev --remote` | Cloudflare Edge | Secrets remotos | `*.workers.dev`  | Testing real      |
| `wrangler deploy`       | Cloudflare Edge | Secrets remotos | Producción       | Deploy final      |

### **Configuración Recomendada**

1. **Desarrollo**: Cada desarrollador usa `.dev.vars` local
2. **Testing colaborativo**: `wrangler dev --remote` para compartir
3. **Producción**: `wrangler deploy` con secrets remotos configurados

### **Seguridad por Ambiente**

- **Local**: Variables en `.dev.vars` (nunca committear)
- **Remoto**: Variables en `wrangler secret put` (encriptado en Cloudflare)
- **Separación clara**: Local vs remoto nunca se mezclan

---

## 📈 Roadmap y Extensiones Futuras

### **Herramientas Académicas Planificadas**

- `POST /tools/academic-validation` → Solo validar credenciales UNP
- `GET /tools/user-lookup` → Buscar usuario por código académico
- `POST /tools/bulk-operations` → Operaciones masivas de usuarios
- `GET /tools/academic-status` → Status y datos académicos

### **Mejoras de Arquitectura**

- Rate limiting por endpoint
- Caching de validaciones académicas
- Métricas y observabilidad
- Testing automatizado end-to-end

### **Integraciones Futuras**

- Más servicios académicos (biblioteca, pagos, etc.)
- Servicios de AI específicos para educación
- APIs de terceros para estudiantes

---

**💡 Esta arquitectura modular permite evolución incremental sin afectar funcionalidad existente**
