# 🧠 Arquitectura

**Flutter + Cloudflare Worker como API Gateway + Supabase Auth
con Validación JWT local y enrutamiento dinámico a múltiples APIs**

---

## ⚙️ Componentes

| Elemento               | Función                                                         |
| ---------------------- | --------------------------------------------------------------- |
| **Flutter**            | UI + manejador de sesión (`access_token`)                       |
| **Cloudflare Worker**  | API Gateway + verificador de identidad                          |
| **Supabase Auth**      | Emisor de tokens JWT firmados                                   |
| **Supabase DB**        | Base de datos PostgreSQL, accedida vía REST, sin RLS            |
| **Servicios externos** | OpenAI, servicios internos, etc. accedidos a través del Gateway |
| **`X-Upstream`**       | Header que indica a qué servicio apuntar (`openai`, `db`, etc.) |

---

# 📐 Flujo General

```
[Flutter] → request con JWT + X-Upstream (Authorization: Bearer xxxxx, X-Upstream: openai)
       ↓
[Worker] → verifica JWT localmente usando clave pública o secreto compartido
       ↓
[Worker] → resuelve X-Upstream → endpoint autorizado según allowedUpstreams
       ↓
[Worker] → opcionalmente verifica permisos por subject (ID de usuario)
       ↓
[Worker] → reenvía la request al destino (OpenAI, Supabase, otros)
       ↓
[Destino] ← responde
```

---

# 🔑 Claves de esta arquitectura

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

## ✅ **3. Enrutamiento seguro con `allowedUpstreams`**

- `X-Upstream` no define directamente la URL de destino
- El Worker solo acepta valores predefinidos en la configuración
- Cada upstream puede tener sus propias cabeceras y restricciones
- Permite controlar precisamente quién puede acceder a cada servicio

## ✅ **4. Manejo seguro de credenciales**

- Las claves API se configuran como variables de entorno secretas (`OPENAI_API_KEY`, etc.)
- Se inyectan automáticamente en la configuración de upstreams en tiempo de ejecución
- Mantiene las credenciales fuera de la configuración JSON `ALLOWED_UPSTREAMS`
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
| `X-Upstream` malicioso        | Solo se permiten valores predefinidos en `allowedUpstreams`           |

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

- Comprueba si el valor está en la configuración `allowedUpstreams`
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
| Complejidad en configuración     | Documentar bien la estructura de `allowedUpstreams` |
| Límites de Cloudflare Workers    | Monitorizar uso de CPU y memoria                    |

---

# 🧰 Implementación actual

1. **Gateway dinámico**:

   - Configuración base mediante variable de entorno `ALLOWED_UPSTREAMS`
   - Formato JSON con mapeo de upstreams y sus configuraciones
   - Cada upstream define `baseUrl` y `restrictions` opcionales
   - Las claves API sensibles se configuran como secretos separados

2. **Control de acceso**:

   - Verificación por `sub` (ID de usuario) en el JWT
   - Configuración granular por upstream
   - Compatibilidad con flujo anterior para Supabase DB

3. **Ejemplo de configuración**:

4. **Configuración de secretos**:

```bash
# Las claves API y secretos se configuran por separado
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put OPENAI_API_KEY
```

5. **Inyección automática de credenciales**:

El código detecta automáticamente qué upstream se está utilizando e inyecta las credenciales correspondientes desde las variables de entorno secretas, manteniendo las claves API fuera de la configuración JSON.
