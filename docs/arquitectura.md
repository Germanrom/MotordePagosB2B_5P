# Arquitectura técnica

## Stack y ejecución

- Node.js y TypeScript con `strict` habilitado.
- Express 5 para HTTP.
- Prisma 5 como ORM.
- PostgreSQL como almacenamiento principal.
- Zod para validar el body de pagos Brick.
- Axios y `fetch` para llamadas a Mercado Pago y callbacks.
- `mercadopago` SDK para las preferencias de la API V1.

El punto de entrada es `src/index.ts`. La conexión Prisma se comparte desde `src/config/prisma.ts`. `docker-compose.yml` levanta PostgreSQL para desarrollo local; no configura el backend ni representa una configuración de producción.

## Organización

```text
src/
├── index.ts                         # Configuración de Express y montaje de rutas
├── config/prisma.ts                 # Instancia compartida de Prisma
├── routes/v1|v2/                    # Mapeo de path + middleware + controlador
├── controllers/v1|v2/               # Adaptación HTTP y códigos de respuesta
├── middlewares/auth.ts              # API key compartida por ambas versiones
├── middlewares/v1/deprecated.ts     # Encabezados de deprecación
├── services/payments/               # Creación, reconciliación y outbox
├── services/mercadopago/            # OAuth state y firma del webhook MP
├── services/security/               # Hashes, HMAC y cifrado de credenciales
├── types/express.d.ts               # Contexto tenant autenticado en req.client
└── utils/hmac.ts                    # Firma HMAC compatible con callbacks V1
```

Las rutas V1 y V2 reexportan el mismo middleware de API key. La capa de pago usa `Client` como identidad persistida y no confía en una identidad de tenant enviada en el body.

## Rutas montadas

| Prefijo | Router |
|---|---|
| `/v1/auth` y alias `/auth` | OAuth legado y callback V1 |
| `/v1/ordenes` | Crear preferencia y consultar estado V1 |
| `/v1/webhook` | Webhook compatible con notificaciones V1 |
| `/v2/auth` | Inicio y callback OAuth V2 |
| `/v2/pagos` | Pago Brick V2 |
| `/v2/ordenes` | Consulta tenant-scoped de estado V2 |
| `/v2/webhook` | Reconciliación de eventos V2 |

`/health` solo reporta que el proceso HTTP responde; hoy no comprueba la conexión de base de datos ni el estado de las colas.

## Límite multi-tenant

`verifyApiKey` hashea la cabecera `X-API-Key`, resuelve un `Client` y lo pone en `req.client`. Si no encuentra el hash, permite una transición desde `Client.api_key` en claro: calcula y guarda el hash al autenticar. El proceso de migración planificado limpia esa columna.

Las consultas de órdenes filtran por `client_id`. Las relaciones de base de datos entre `Order`, `Payment`, `Vendor` y `WebhookEvent` incluyen el tenant en claves foráneas compuestas. En V2, `Vendor.v2_active` designa la cuenta cobradora activa; existe un índice parcial para permitir como máximo una activa por cliente.

## Persistencia de webhooks y callbacks

- `WebhookEvent` guarda primero el evento MP validado y permite reclamarlo con lock y contador de intentos.
- El worker reintenta eventos fallidos y locks vencidos cada cinco segundos.
- `CallbackDelivery` persiste payload, URL y firma antes de enviarlos.
- Cada callback lleva un `event_id` estable por transición de pago en el body y las cabeceras `x-motor-event-id`/`Idempotency-Key`.
- El worker de callbacks reclama una fila con `FOR UPDATE SKIP LOCKED`, envía con timeout y vuelve a programar fallos con espera exponencial limitada a una hora.
- Ambos workers viven en el proceso HTTP y usan PostgreSQL para coordinar varias instancias.

La entrega al callback es **at least once**: si el sistema destino procesa el mensaje pero la respuesta se pierde, el motor no puede saberlo y puede volver a enviarlo. El destino debe persistir y deduplicar el `event_id` para evitar repetir efectos.

## Proveedor de pagos

La llamada de Brick se hace a `POST https://api.mercadopago.com/v1/payments` usando el token Brick, credencial descifrada de la cuenta y la clave idempotente persistida del proveedor. El webhook consulta `GET /v1/payments/{id}` con el token de la cuenta que recibió la notificación. Antes de aplicar el estado, se comprueba que la cuenta, referencia, importe y moneda coincidan con la orden tenant-scoped.

La identidad de cuentas migradas sin `mp_user_id` se verifica con `/users/me` antes de iniciar un cobro o conciliar un webhook. Las cuentas OAuth V2 guardan el ID recibido en la respuesta de autorización.
