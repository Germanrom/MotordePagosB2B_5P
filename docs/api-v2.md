# API V2

Base path: el host público configurado en `APP_BASE_URL`. Los ejemplos omiten el host. Los endpoints autenticados requieren `X-API-Key`; las claves se usan exclusivamente desde backend a backend.

## Autenticación y vinculación OAuth

### `GET /v2/auth/mp-url`

Requiere `X-API-Key`. Devuelve una URL OAuth y crea previamente un estado aleatorio de 32 bytes, persistido como hash durante diez minutos.

```http
GET /v2/auth/mp-url
X-API-Key: <api-key-del-tenant>
```

```json
{ "auth_url": "https://auth.mercadopago.com/authorization?..." }
```

Mercado Pago debe tener registrado como callback `APP_BASE_URL + /v2/auth/callback`.

### `GET /v2/auth/account`

Requiere `X-API-Key`. Devuelve solo información no secreta de la cuenta activa: `connected`, `public_key` y `expires_at`. El backend puede pasar `public_key` al navegador para configurar el Brick. Nunca devuelve access token, refresh token ni API key.

### `GET /v2/auth/callback`

Público: lo invoca Mercado Pago. Recibe `code` y `state`, consume el estado una sola vez, intercambia el código, cifra los tokens y activa la cuenta para V2. Si ese tenant tenía otra cuenta V2 activa, queda desactivada para nuevas operaciones. La ruta no devuelve tokens; intenta llamar al callback de vinculación y redirige al `redirect_uri` del tenant.

Respuestas relevantes: `400` para callback o estado inválido/expirado/consumido; `409` si la cuenta ya está vinculada a otro tenant; `502` si falla el intercambio.

## Crear un pago Brick

### `POST /v2/pagos/brick`

Requiere:

```http
X-API-Key: <api-key-del-tenant>
Idempotency-Key: <clave-unica-generada-por-el-backend-del-tenant>
Content-Type: application/json
```

Body estricto:

```json
{
  "external_id": "pedido-10001",
  "concepto": "Compra 10001",
  "transaction_amount": 1250.50,
  "currency_id": "ARS",
  "token": "<token-generado-por-brick>",
  "installments": 1,
  "payment_method_id": "visa",
  "payer": {
    "email": "comprador@example.com",
    "identification": { "type": "DNI", "number": "12345678" }
  }
}
```

`issuer_id` es opcional. `currency_id` acepta `ARS`; el importe debe ser positivo y tener como máximo dos decimales. Se rechazan propiedades desconocidas como `vendor_id`.

Respuesta de ejemplo:

```json
{
  "id_pago": "uuid-del-intento",
  "id_orden": "uuid-de-la-orden",
  "external_id": "pedido-10001",
  "estado": "approved",
  "status_detail": "accredited",
  "mp_payment_id": "123456789"
}
```

La misma clave y contenido devuelve la operación persistida. La misma clave con otro contenido devuelve `409 idempotency_conflict`. Reutilizar `external_id` con importe, moneda, concepto o cuenta distintos devuelve conflicto. Si MP no responde, se devuelve `502` y el llamador puede repetir la misma solicitud con la misma clave.

Errores principales:

| HTTP | Código | Significado |
|---:|---|---|
| `400` | `idempotency_key_required` | Falta la cabecera o excede 128 caracteres. |
| `401` | `api_key_required` / `invalid_api_key` | API key ausente o inválida. |
| `409` | `mp_account_not_connected` | Tenant sin cuenta activa V2. |
| `409` | `mp_account_reauthorization_required` | Token vencido o identidad de cuenta no verificable. |
| `409` | `idempotency_conflict` | La clave ya representa otro body. |
| `409` | `external_id_conflict` | Referencia externa existente con otros datos. |
| `409` | `external_id_account_conflict` | Referencia externa ya ligada a otra cuenta cobradora. |
| `422` | `validation_error` | Body Brick inválido. |
| `422` | `payment_not_accepted` | MP no aceptó la solicitud y devolvió un recurso pendiente. |
| `502` | `payment_provider_unavailable` / `payment_provider_error` | Fallo de red o respuesta incompleta de MP. |
| `502` | `payment_provider_status_unsupported` | MP respondió con un estado que el motor todavía no reconoce. Reintentar con la misma clave; el evento entrante queda pendiente de reconciliación. |
| `502` | `payment_provider_mismatch` | La respuesta MP no coincide con la cuenta u orden. |

## Consultar una orden

### `GET /v2/ordenes/:id/estado`

Requiere `X-API-Key`. Busca por UUID y por tenant autenticado; una orden de otro tenant se presenta como no encontrada.

Respuesta: `id_orden`, `external_id`, estado actual, `mp_payment_id`, fecha de actualización y `ultimo_pago` cuando existe.

## Webhook entrante de Mercado Pago

### `POST /v2/webhook/mercadopago?account_id=<vendor-id>`

Público para Mercado Pago, validado mediante `x-signature`, `x-request-id` y `MP_WEBHOOK_SECRET`. El ID del recurso llega en `data.id` de query y/o en el body. Si ambas fuentes lo incluyen, deben coincidir. El `account_id` indica qué cuenta MP del motor recibió la notificación; el motor nunca toma el tenant del body.

Eventos de pago válidos se persisten y procesan. Un duplicado completado devuelve `200`; una firma inválida devuelve `403`; un evento no procesable por fallo temporal devuelve `503` para permitir reintento. Los eventos no relacionados con pagos se ignoran con `200`.

## Callback saliente del motor

El motor publica en `Client.callback_url` JSON con:

```json
{
  "event_id": "123456789:PENDING>APPROVED",
  "id_orden": "uuid-de-la-orden",
  "external_id": "pedido-10001",
  "estado": "approved",
  "mp_payment_id": "123456789",
  "monto": "1250.50",
  "moneda": "ARS"
}
```

Las cabeceras `x-motor-event-id` y `Idempotency-Key` repiten el `event_id` estable de la transición. La firma HMAC-SHA256 cubre el JSON canónico (claves de objetos ordenadas recursivamente), incluido `event_id`, usando `Client.webhook_secret`. El callback puede repetirse después de un timeout; el receptor debe verificar la firma y persistir `event_id` como único antes de aplicar efectos. No se incluye timestamp en esta firma.
