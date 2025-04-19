# 🧠 Arquitectura

**Flutter + Cloudflare Worker + Supabase (Auth + DB)
con Validación JWT local y Service Role**

---

## ⚙️ Componentes

| Elemento              | Función                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| **Flutter**           | UI + manejador de sesión (`access_token`)                               |
| **Cloudflare Worker** | Backend serverless + verificador de identidad                           |
| **Supabase Auth**     | Emisor de tokens JWT firmados                                           |
| **Supabase DB**       | Base de datos PostgreSQL, accedida vía REST, sin RLS, solo desde Worker |
| **`service_role`**    | Llave secreta usada únicamente en el Worker, con acceso sin RLS         |

---

# 📐 Flujo General

```
[Flutter] → login/signup → recibe access_token
       ↓
[Flutter] → request a Worker con ese JWT (Authorization: Bearer xxxxx)
       ↓
[Worker] → verifica JWT localmente usando clave pública de Supabase
       ↓
[Worker] → si es válido, reenvía la request a Supabase con service_role
       ↓
[Supabase DB] ← responde
```

---

# 🔑 Claves de esta arquitectura

## ✅ **1. El JWT se valida localmente**

- No se hace una llamada adicional al endpoint `/auth/v1/user` para validar cada solicitud (excepto cuando se solicita específicamente)
- Se usa la librería `jose` para validar la firma JWT con la clave pública JWK de Supabase (`/.well-known/jwks.json`)
- Se cachea la JWK para mejorar el rendimiento

## ✅ **2. El Worker maneja TODO**

- El único con `service_role` es el Worker
- Flutter **no tiene claves sensibles**
- Flutter solo maneja el `access_token` (JWT)
- La base **no usa RLS**, pero está protegida porque solo el Worker accede usando `service_role`

---

# 🔐 ¿Por qué es seguro?

| Riesgo                        | Mitigación                                      |
| ----------------------------- | ----------------------------------------------- |
| Clave filtrada                | `service_role` nunca está en el cliente         |
| Session hijack (token robado) | JWT firmado, validado local, expira rápido      |
| Acceso sin auth               | Worker niega cualquier request sin token válido |
| Bypass del Worker             | Supabase solo permite acceso con `service_role` |

---

# 📚 Flujo Detallado

## 🔸 1. Login, signup o refresh token (Flutter → Worker → Supabase Auth)

```
POST https://tu-worker.workers.dev/auth/login
POST https://tu-worker.workers.dev/auth/signup
POST https://tu-worker.workers.dev/auth/refresh
```

El Worker reenvía estas solicitudes a los endpoints de Supabase Auth:

- `/auth/v1/token?grant_type=password` (login)
- `/auth/v1/signup` (registro)
- `/auth/v1/token?grant_type=refresh_token` (refresh)

Devuelve como respuesta:

- `access_token` (JWT firmado por Supabase)
- `refresh_token`
- `user`

## 🔸 1.1. Verificación de usuario (Flutter → Worker → Supabase Auth)

```
GET https://tu-worker.workers.dev/auth/user
Authorization: Bearer <access_token>
```

El Worker reenvía esta solicitud al endpoint `/auth/v1/user` de Supabase Auth para verificar la sesión del usuario.

---

## 🔸 2. Flutter guarda ese `access_token`

Puede usar `flutter_secure_storage` o incluso memoria.

---

## 🔸 3. Flutter hace peticiones a DB (vía Worker)

```
GET https://tu-worker.workers.dev/rest/v1/messages?user_id=eq.abc
Authorization: Bearer <access_token>
```

---

## 🔸 4. Worker valida el JWT (local)

- Usa la librería `jose` para Web Crypto
- Obtiene la JWK de Supabase y la cachea para mejorar el rendimiento
- Verifica la firma usando el `kid` (key ID) en el header del JWT
- Verifica implícitamente la expiración y otros claims

---

## 🔸 5. Si válido → el Worker hace la request real a Supabase

```
POST https://supabase/rest/v1/messages
Headers:
  Authorization: Bearer service_role
  Content-Type: application/json
  Prefer: return=representation
```

---

## 🔸 6. Si no es válido → responde 401 Unauthorized

---

# 🧠 Ventajas de este plan

| Ventaja                                     | Por qué importa                      |
| ------------------------------------------- | ------------------------------------ |
| Sin RLS                                     | Simple, flexible, control absoluto   |
| No `anon key` en Flutter                    | Menor superficie de ataque           |
| No doble request por validación             | Menor latencia y coste               |
| Flutter se queda solo con el `access_token` | Token revocable, temporal, seguro    |
| Centralización de control en Worker         | Todo el poder, en una sola frontera  |
| Portabilidad                                | Puedes cambiar de Supabase más fácil |

---

# ❌ Riesgos o desafíos

| Riesgo                              | Mitigación                                          |
| ----------------------------------- | --------------------------------------------------- |
| Worker mal protegido = acceso total | Validar JWT estrictamente                           |
| Token expirado                      | Flutter debe refrescar (`grant_type=refresh_token`) |
| Complejidad en Worker (JWT + DB)    | Modularizar código, manejar errores bien            |

---

# 🧰 Implementación actual

1. **Endpoints de autenticación**:

   - `/auth/signup`: Registro de usuarios
   - `/auth/login`: Inicio de sesión
   - `/auth/refresh`: Renovación de tokens
   - `/auth/user`: Verificación de sesión

2. **Endpoint para acceso a la base de datos**:

   - `/rest/v1/...`: Valida JWT localmente y reenvía la solicitud a Supabase usando `service_role`

3. **Características clave**:
   - Verificación de JWT usando la biblioteca `jose`
   - Cacheo de claves JWK para mejor rendimiento
   - Manejo de errores robusto
   - Log detallado para depuración
   - Validación de URL y formato
