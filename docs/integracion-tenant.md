# Integración de un tenant

Esta guía cubre una plataforma que quiere cobrar a sus compradores con su propia cuenta Mercado Pago usando el motor de FivePeaks. El backend de la plataforma es el único componente que conoce la API key del motor.

## 1. Dar de alta el tenant

Un tenant es un registro `Client`. Por ejemplo, `ENUAR` es un `Client`; su sitio web, panel de administración y backend pueden compartirlo si pertenecen al mismo sistema integrado.

Un operador de FivePeaks crea el tenant desde el repositorio con:

```bash
npm run tenant:create -- \
  --client-id ENUAR \
  --callback-url https://api.enuar.example.com/webhooks/fivepeaks \
  --redirect-uri https://app.enuar.example.com/admin/settings
```

El comando genera una `api_key` y un `webhook_secret`, guarda sus hashes/cifrado en la base y los imprime una sola vez. Copiarlos inmediatamente a una secret manager y entregarlos al backend autorizado de ENUAR. No guardarlos en frontend, repositorio, tickets ni logs. `client_id` debe ser único; callback y redirect deben usar HTTPS fuera de localhost.

El alta requiere `DATABASE_URL`, `DIRECT_URL` y `TOKEN_ENCRYPTION_KEY`. El script falla si el identificador ya existe; no reemplaza credenciales existentes.

## 2. Configurar Mercado Pago

El equipo que opera el motor configura la aplicación OAuth de Mercado Pago con:

```text
<APP_BASE_URL>/v2/auth/callback
```

También configura `MP_CLIENT_ID`, `MP_CLIENT_SECRET` y `MP_WEBHOOK_SECRET` en la secret manager del motor. `APP_BASE_URL` tiene que ser el host público del backend y coincidir con el redirect URI registrado en MP.

## 3. Vincular la cuenta cobradora

El backend del tenant llama:

```http
GET /v2/auth/mp-url
X-API-Key: <api_key-del-tenant>
```

La respuesta trae `auth_url`. El backend puede devolverla a su panel de administración o redirigir al navegador del operador. El usuario inicia sesión en la cuenta Mercado Pago que recibirá los cobros y autoriza la aplicación.

Mercado Pago redirige al motor. El motor consume el `state` de un solo uso, cifra las credenciales y activa la cuenta vinculada. Luego intenta notificar el resultado a `callback_url` y redirige al usuario a `redirect_uri`.

Tras completar el OAuth, el backend del tenant consulta el estado de conexión:

```http
GET /v2/auth/account
X-API-Key: <api_key-del-tenant>
```

Respuesta conectada:

```json
{
  "connected": true,
  "public_key": "APP_USR-...",
  "expires_at": "2026-09-26T18:00:00.000Z"
}
```

Sin cuenta activa devuelve `connected: false`, `public_key: null` y `expires_at: null`. La public key puede enviarse al frontend para inicializar el Brick; la API key y el access token MP nunca deben exponerse allí.

## 4. Renderizar el Payment Brick

El frontend del tenant carga el SDK oficial de Checkout Bricks e inicializa el Payment Brick con la public key obtenida para ese tenant y el importe que muestra su pantalla. Mercado Pago documenta los pasos de [inicialización y renderizado](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/payment-brick/default-rendering) y el [envío server-side del pago](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/payment-brick/payment-submission/introduction).

Cuando se ejecuta `onSubmit`, el frontend manda los datos de formulario del Brick al backend del tenant. El frontend no llama al motor con la API key.

El backend debe validar esos datos contra su propia orden/sesión de compra, y construir un body con los campos aceptados por FivePeaks:

| Campo del motor | Origen/uso |
|---|---|
| `external_id` | ID estable de la orden en el sistema del tenant. |
| `concepto` | Descripción corta de la compra. |
| `transaction_amount` | Importe de la orden que el backend ya conoce; no confiar solo en el importe del navegador. |
| `currency_id` | `ARS`. |
| `token` | Token temporal generado por el Brick. |
| `installments` | Cuotas elegidas en el formulario. |
| `payment_method_id` | Medio seleccionado por el Brick. |
| `issuer_id` | Si el Brick lo devuelve, opcional. |
| `payer` | Email e identificación del comprador requeridos por el medio. |

El endpoint requiere `Idempotency-Key`. Generar una clave aleatoria por intento de cobro y persistirla en el backend del tenant mientras se reintenta esa misma solicitud. Reutilizar la clave con datos diferentes produce `409`. No usar el API key de FivePeaks como clave de idempotencia.

Ejemplo de llamada desde el backend:

```http
POST /v2/pagos/brick
X-API-Key: <api_key-del-tenant>
Idempotency-Key: 1b0b6c16-c3a2-4d2b-95b5-2fa65476ad8e
Content-Type: application/json
```

```json
{
  "external_id": "pedido-10001",
  "concepto": "Pedido 10001",
  "transaction_amount": 1250.5,
  "currency_id": "ARS",
  "token": "<token-del-brick>",
  "installments": 1,
  "payment_method_id": "visa",
  "payer": { "email": "comprador@example.com" }
}
```

El motor obtiene la cuenta MP activa; el request no debe incluir `vendor_id`. Si una orden usa una referencia anterior pero cambia su cuenta/importe/concepto/moneda, el backend debe resolver la operación de negocio antes de reintentar. `external_id` no se puede reutilizar con otros datos para el mismo tenant.

La respuesta informa el intento de pago. `approved` confirma aprobación; `pending` requiere esperar confirmación. El backend puede consultar `GET /v2/ordenes/:id/estado`, pero no debe tomar el redirect visual del comprador como confirmación del pago.

## 5. Recibir el callback del motor

Configurar `callback_url` para un endpoint server-side HTTPS del tenant. El motor manda un JSON con `event_id`, orden, referencia, estado, ID de pago MP, importe y moneda. Envía:

- `x-motor-signature`: HMAC-SHA256 hexadecimal del JSON canónico (claves de objetos ordenadas recursivamente), usando el `webhook_secret` entregado al crear el tenant.
- `x-motor-event-id`: identificador estable de la transición.
- `Idempotency-Key`: el mismo identificador estable para facilitar deduplicación.

El receptor debe normalizar el JSON de manera canónica antes de verificar la firma, persistir `event_id` como único y responder `2xx` solo después de aceptar el evento. Si ya procesó ese `event_id`, debe responder `2xx` sin repetir efectos. El motor reintenta si recibe error o timeout; por eso pueden llegar callbacks repetidos.

## 6. Probar integración

1. Levantar una base de desarrollo y crear el tenant.
2. Configurar OAuth sandbox/test y un callback público temporal HTTPS si MP necesita volver al entorno local.
3. Vincular la cuenta y confirmar `GET /v2/auth/account`.
4. Renderizar el Brick y completar una compra de prueba.
5. Confirmar que la respuesta inmediata y `GET /v2/ordenes/:id/estado` corresponden a la misma orden.
6. Confirmar el webhook MP en `WebhookEvent` y la notificación saliente en `CallbackDelivery`.
7. Repetir un webhook y una entrega callback para verificar deduplicación.

La guía de infraestructura está en [desarrollo local con Docker](./desarrollo-local-docker.md). Los formatos/tipos del Brick pueden evolucionar; consultar la [documentación oficial de envío](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/payment-brick/payment-submission/introduction) y mapear explícitamente su `formData` al contrato FivePeaks.
