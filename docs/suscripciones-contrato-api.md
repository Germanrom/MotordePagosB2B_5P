# Contrato propuesto para suscripciones SaaS

Este contrato guía las fases 1 a 4 del [plan](plan-suscripciones-saas-fivepeaks.md). El alta productiva permanece bloqueada hasta aprobar la [fase 0](suscripciones-fase-0.md). Las apps integradas llaman desde su backend con `X-API-Key`; el navegador solo recibe el `init_point` para redirigir al pagador.

## Identidad y catálogo

`Client.client_id` identifica a la app integrada. `external_tenant_id` identifica a su tenant; FivePeaks no interpreta ni modifica el acceso de ese tenant. La app conserva el catálogo. En cada alta envía `plan_code`, `plan_version`, importe y moneda; FivePeaks guarda una copia de los términos para poder auditar lo que se autorizó. La app debe verificar el importe contra su catálogo antes de llamar al motor.

La migración agrega `Client.subscription_callback_url`, separada de la URL de callbacks de órdenes. Debe configurarse como URL HTTPS del backend de la app. El secreto HMAC puede ser el `webhook_secret` cifrado ya asociado al `Client` en esta primera versión; una rotación independiente podrá añadirse si se necesita.

## Alta

`POST /v2/subscriptions` requiere `X-API-Key` e `Idempotency-Key` (1 a 128 caracteres). Body previsto:

```json
{
  "external_tenant_id": "valikt-empresa-123",
  "plan_code": "pro",
  "plan_version": "2026-10",
  "amount": "25000.00",
  "currency": "ARS",
  "payer_email": "pagador@example.com",
  "terms": {
    "description": "Plan Pro mensual",
    "billing_day": 5,
    "terms_url": "https://app.example.com/planes/pro/2026-10"
  },
  "return_url": "https://app.example.com/facturacion/retorno"
}
```

`return_url` es de navegación y debe estar registrada/permitida para la app. La URL de callback backend se toma de la configuración del `Client`, nunca del body. FivePeaks devuelve `subscription_id`, `status: pending_checkout` e `init_point` al crear el recurso de Mercado Pago. No devuelve un estado activo hasta verificar el primer pago en el backend. Repetir la clave con el mismo body devuelve el mismo alta; repetirla con otro body devuelve `409`. Un segundo alta abierta para el mismo par app/tenant devuelve `409`.

La ruta de alta ya está implementada detrás de `SAAS_SUBSCRIPTIONS_CHECKOUT_ENABLED=false`. Usa provisionalmente `/preapproval` sin plan asociado y `status: pending`; se habilitará solo si el ensayo de fase 0 confirma que ese flujo puede cumplir el calendario. `return_url` debe compartir origen con `Client.redirect_uri`. La consulta `GET /v2/subscriptions/:id` también está implementada y restringida a la app autenticada.

Si la creación en Mercado Pago da timeout después de haber aceptado la operación, FivePeaks conserva el alta como `RECONCILIATION_REQUIRED`. Al repetir la solicitud, busca por email y coteja la referencia externa con el ID local; si no puede confirmar exactamente un recurso, responde `202 subscription_reconciliation_required` y no envía un segundo `POST`.

## Consulta y cambios

- `GET /v2/subscriptions/:id` devuelve estado local, plan vigente, plan programado, `next_payment_at`, último período y `paid_through`, siempre acotado al `Client` autenticado.
- `POST /v2/subscriptions/:id/plan-change` programa código, versión, términos e importe nuevos para el próximo período. No modifica el importe del período en curso.
- `POST /v2/subscriptions/:id/cancel` programa el cese de futuras renovaciones. Hasta que el proveedor confirme la cancelación, el estado de la solicitud y el estado real del proveedor se muestran por separado.

Los cambios programados necesitan un worker y una conciliación con Mercado Pago antes del próximo cargo. El momento exacto de corte debe salir de la fase 0 y de la observación de cuándo Mercado Pago crea la siguiente factura. La app decide el acceso a partir de sus reglas y los períodos confirmados.

## Eventos salientes

FivePeaks envía callbacks firmados a `subscription_callback_url` con `event_id` estable. Eventos previstos: `subscription.authorized`, `subscription.payment_approved`, `subscription.payment_rejected`, `subscription.payment_recovered`, `subscription.plan_changed` y `subscription.cancelled`. Cada evento incluye `subscription_id`, `external_tenant_id`, `plan_code`, `plan_version`, importe, moneda, ID de factura y período cuando correspondan. Los callbacks son *at least once*: la app debe deduplicar `event_id` antes de aplicar efectos.

El retorno del navegador no emite ni reemplaza un callback de pago. Los eventos de Mercado Pago son disparadores: FivePeaks consulta `/preapproval/{id}`, `/authorized_payments/{id}` y `/v1/payments/{id}` según el tópico y comprueba que la cuenta cobradora, referencia, importe y moneda correspondan a la suscripción local.
