# 🔍 Análisis Técnico — Motor de Pagos B2B

## ¿Qué es este proyecto?

Un **motor de pagos B2B multi-tenant** que actúa como intermediario entre sistemas cliente (ej. `centroenuar`) y Mercado Pago. Maneja el flujo OAuth de vinculación de cuentas MP, la creación de preferencias de pago, y la recepción/reenvío de webhooks de pago.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología | Versión |
|---|---|---|
| **Runtime** | Node.js | (implícito por deps) |
| **Lenguaje** | TypeScript | `^6.0.3` |
| **Framework HTTP** | Express | `^5.2.1` (v5!) |
| **ORM / Base de datos** | Prisma + PostgreSQL | `^5.22.0` |
| **Validación** | Zod | `^4.3.6` |
| **Pagos** | Mercado Pago SDK | `^2.12.0` |
| **HTTP Client** | Axios | `^1.15.2` |
| **Auth/Seguridad** | HMAC SHA-256 (crypto nativo) | — |
| **Config** | dotenv | `^17.4.2` |
| **Dev Server** | nodemon + tsx | hot-reload |
| **Contenedores** | Docker Compose | postgres:15 |
| **Legacy (archivado)** | Python (FastAPI/Flask + SQLite) | `_legacy_python/` |

---

## 📁 Estructura del Proyecto

```
Motor-de-pagos/
├── src/
│   ├── index.ts              ← Entry point (Express)
│   ├── config/
│   │   └── prisma.ts         ← Singleton Prisma client
│   ├── controllers/
│   │   ├── auth.controller.ts    ← OAuth MP flow
│   │   ├── order.controller.ts   ← Crear/consultar órdenes
│   │   └── webhook.controller.ts ← Recibir webhook de MP y reenviar
│   ├── middlewares/
│   │   └── auth.ts           ← Verificación API Key
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── order.routes.ts
│   │   └── webhook.routes.ts
│   ├── types/
│   │   └── express.d.ts      ← Augmenta Request con `req.client`
│   └── utils/
│       └── hmac.ts           ← Firma/verificación HMAC
├── prisma/
│   ├── schema.prisma         ← Modelos: Client, Vendor, Order
│   └── migrations/
├── scripts/
│   └── seed_client.ts        ← Script para insertar cliente en BD
├── _legacy_python/           ← Versión anterior en Python (archivada)
├── docker-compose.yml        ← Solo levanta PostgreSQL
└── .env.example
```

**Patrón arquitectónico:** MVC clásico (Routes → Controllers → Prisma ORM). Limpio y correcto para el tamaño del proyecto.

---

## ✅ Lo que está bien

- **Separación de responsabilidades clara**: routes / controllers / middlewares / utils bien definidos.
- **Validación con Zod** en `createOrder`: buena práctica, evita datos basura en DB.
- **Seguridad HMAC bilateral**: valida firma de MP al recibir webhooks **y** firma los webhooks salientes hacia los clientes. Esto es profesional.
- **`timingSafeEqual`** en comparaciones de firma: previene ataques de timing. Excelente detalle.
- **Multi-tenant real**: el modelo `Client → Vendor → Order` soporta múltiples clientes B2B con vendors propios.
- **TypeScript estricto** (`"strict": true`) habilitado.
- **Express v5**: ya usando la versión más reciente (async error handling mejorado).
- **Docker Compose** para base de datos local: facilita el onboarding.
- **`_legacy_python` archivado** separado: limpio, no contamina el código activo.

---

## 🐛 Bugs Críticos

### 1. `app.listen()` se llama DOS veces en `index.ts`

```typescript
// Línea 23 — primera llamada
app.listen(PORT, () => { console.log(`Servidor corriendo en el puerto ${PORT}`); });

// ... middlewares y rutas se registran DESPUÉS ...

// Línea 38 — segunda llamada (bug real)
app.listen(PORT, () => { console.log(`Server is running on port ${PORT}`); });
```

> **Impacto:** El servidor intenta bindear el mismo puerto dos veces. En Node.js esto causa `EADDRINUSE` crash o comportamiento impredecible. Además, los middlewares (`cors`, las rutas) se registran **después** del primer `listen`, por lo que las primeras requests no tienen CORS ni rutas.

### 2. `cors()` sin configuración (wildcard total)

```typescript
app.use(cors()); // Acepta requests de CUALQUIER origen
```

> En un motor B2B que recibe API Keys sensibles, esto es un riesgo. Debería tener una whitelist de orígenes.

### 3. `api_key` almacenada en texto plano

```typescript
const client = await prisma.client.findFirst({
  where: { api_key: apiKey }, // Búsqueda por texto plano
});
```

> Las API Keys deberían almacenarse como hash (bcrypt o SHA-256) y compararse contra el hash, no en texto plano. Una filtración de la DB expone todas las keys.

### 4. URL de producción hardcodeada en el código fuente

```typescript
// auth.controller.ts línea 27
const redirectUri = 'https://motor-de-pagos-api.onrender.com/auth/callback';

// order.controller.ts línea 54
const urlNgrok = "https://motor-de-pagos.onrender.com";
```

> Dos URLs distintas para supuestamente el mismo servicio. Deben ir a variables de entorno (`APP_URL` o `BASE_URL`).

### 5. Comentarios de desarrollo en producción

```typescript
// 👇 ACÁ VA TU MAGIA DE NGROK
// Reemplazá esta URL por la que te dio tu terminal...
//const urlNgrok = "https://starry-provided-likeness.ngrok-free.dev";

back_urls: {
  success: "https://www.google.com", // Placeholder!
  failure: "https://www.google.com",
  pending: "https://www.google.com"
}
```

> `back_urls` apuntan a Google. Los usuarios tras pagar son redirigidos a Google.com.

### 6. Webhook: firma de MP validada, pero puede crashear

```typescript
return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(v1));
```

> Si `v1` tiene longitud diferente a `expectedSignature`, `timingSafeEqual` lanza una excepción (no devuelve `false`). Esto causa un 500 en lugar de un 403. Debería verificarse el largo antes.

---

## ⚠️ Mejoras de Seguridad Importantes

| Problema | Solución |
|---|---|
| API Key en texto plano | Hashear con `bcrypt` o `SHA-256` al guardar, comparar hash |
| CORS wildcard | `cors({ origin: ['https://centroenuar.com', ...] })` |
| URLs hardcodeadas | `process.env.APP_BASE_URL` |
| `webhook_secret` hardcodeado en seed | Generar con `crypto.randomBytes(32).toString('hex')` |
| Sin rate limiting | Agregar `express-rate-limit` en endpoints de auth |
| Sin helmet | Agregar `helmet` para headers de seguridad HTTP |
| Tokens MP sin encriptar en DB | Encriptar `mp_access_token` y `mp_refresh_token` en reposo |

---

## 🚀 Mejoras de Funcionalidad

### Alta Prioridad
1. **Refresh de tokens MP**: Los `access_token` de MP expiran. No hay lógica de refresh (`mp_refresh_token` se guarda pero nunca se usa).
2. **Reintentos de webhook**: El código tiene el comentario `// Acá se podría implementar una lógica de reintentos` pero no está implementado. Si el webhook al cliente falla, el pago queda huérfano.
3. **`back_urls` dinámicas**: Deben venir del `Client` en BD o del request de `createOrder`, no hardcodeadas.
4. **Manejo de pagos `pending`**: Solo se procesa `approved`. Los pagos pendientes (ej. efectivo) quedan sin actualizar.

### Media Prioridad
5. **Endpoint para listar vendors**: No hay forma de que un cliente consulte qué vendors tiene vinculados.
6. **Endpoint para desvincular vendor**: No hay `DELETE /vendors/:id`.
7. **`mp_email` del vendor**: En el callback se usa un placeholder `'cuenta_vinculada@mercadopago.com'`. Debería obtenerse con una llamada a `GET /users/me` de MP tras el OAuth.
8. **Idempotencia en webhooks**: Si MP reenvía un webhook ya procesado, la orden se intenta actualizar de nuevo. Debería ignorarse si `estado !== 'PENDING'` (esto está parcialmente, pero el webhook saliente al cliente se reenviaría igual).

### Baja Prioridad
9. **Logging estructurado**: Cambiar `console.log/error` por un logger como `pino` o `winston` con niveles y JSON output (útil para observabilidad en producción).
10. **Script de seed más seguro**: El `seed_client.ts` tiene valores hardcodeados de producción (callback_url, redirect_uri de centroenuar).
11. **`DIRECT_URL` en schema.prisma**: Referenciada como env var pero no está en `.env.example`.
12. **Tests**: No hay ningún test unitario ni de integración.

---

## 📦 Deuda Técnica Menor

- `"main": "index.js"` en `package.json` debería ser `"dist/index.js"` (o eliminarse ya que hay `start` script).
- `__pycache__` en el root del repo: debería estar en `.gitignore` (en realidad sí está, pero el directorio persiste trackeado por error previo).
- No hay `README.md` visible con documentación de la API.
- `"type": "commonjs"` en `package.json` es correcto pero podría migrarse a `"module"` con `"module": "ESNext"` en tsconfig para consistencia moderna.

---

## 📊 Puntuación General

| Dimensión | Nota | Detalle |
|---|---|---|
| **Arquitectura** | 8/10 | MVC limpio, bien separado, multi-tenant correcto |
| **Seguridad** | 4/10 | HMAC bien hecho, pero API Keys en texto plano y CORS wildcard son problemas serios |
| **Calidad de código** | 6/10 | Buen TypeScript, pero bug crítico de doble `listen` y hardcoding |
| **Completitud funcional** | 5/10 | El happy path funciona, pero faltan refresh tokens, reintentos, y varios endpoints |
| **Testing** | 0/10 | Sin tests |
| **Documentación** | 3/10 | Comentarios en el código, pero sin README/API docs |

---

## 🗺️ Roadmap Sugerido

```
Fase 1 — Bugs críticos (1-2 días)
  ✦ Fix doble app.listen()
  ✦ Mover URLs hardcodeadas a .env
  ✦ Fix timingSafeEqual crash por longitud diferente
  ✦ back_urls dinámicas

Fase 2 — Seguridad (3-5 días)
  ✦ Hash de API Keys
  ✦ CORS con whitelist
  ✦ helmet + rate limiting
  ✦ Encriptar tokens MP en DB

Fase 3 — Features faltantes (1-2 semanas)
  ✦ Refresh de tokens MP (cron job o lazy refresh)
  ✦ Queue de reintentos para webhooks fallidos
  ✦ Obtener mp_email real post-OAuth
  ✦ Endpoints CRUD de vendors
  ✦ Manejo de pagos pending

Fase 4 — Calidad (ongoing)
  ✦ Tests unitarios (Jest/Vitest)
  ✦ Logger estructurado (pino)
  ✦ README + documentación de API (OpenAPI/Swagger)
```
