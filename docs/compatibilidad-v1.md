# Compatibilidad V1

V1 es el contrato para crear links de pago con Checkout Pro. Sigue activa para integraciones que necesitan redirigir al comprador a Mercado Pago. V2 ofrece el flujo de Payment Brick para cobrar dentro de la experiencia del tenant. Ambas versiones comparten autenticación y procesamiento multi-tenant.

## Rutas vigentes

| Método | Ruta | Autenticación | Uso |
|---|---|---|---|
| `GET` | `/v1/auth/mp-url` | `X-API-Key` | Inicia el OAuth legado; actualmente exige `client_id` en query y permite selector histórico `vendor_id`. |
| `GET` | `/v1/auth/callback` | Pública | Callback OAuth legado. |
| `GET` | `/auth/callback` | Pública | Alias legado registrado históricamente en Mercado Pago. |
| `POST` | `/v1/ordenes` | `X-API-Key` | Crea orden y preferencia Checkout Pro para un `vendor_id` del mismo tenant. |
| `GET` | `/v1/ordenes/:id/estado` | `X-API-Key` | Consulta orden filtrada por tenant autenticado. |
| `POST` | `/v1/webhook?vendedor_id=<id>` | Firma de MP | Acepta webhooks de pagos vinculados a órdenes V1. |

Los pagos/órdenes existentes mantienen `Vendor` y `Order`; al procesar sus webhooks, la ruta compartida también crea registros `Payment` y usa la cola durable de callback.

## Diferencias con V2

- V1 conserva `vendor_id`, crea una preferencia de Checkout Pro y devuelve su `checkout_url`.
- V2 cobra con Payment Brick, no acepta `vendor_id` y usa la cuenta V2 activa del tenant.
- El callback OAuth V1 usa estado compuesto por identificadores del cliente/vendor. No tiene el `state` aleatorio, temporal y de un solo uso de V2.
- El callback V1 sigue teniendo URL de redirect hardcodeada en el controlador. Antes de cambiar dominio, revisar la URL configurada en Mercado Pago y ese controlador.
- Los tokens guardados por nuevas vinculaciones V1 quedan cifrados; los tokens históricos requieren ejecutar el backfill de credenciales.

## Mantenimiento de V1

V1 y su alias histórico `/auth` no envían encabezados de obsolescencia. Mantener las URLs de callback registradas en Mercado Pago y el contrato `vendedor_id` mientras existan integraciones que creen links con V1. Cualquier futura retirada de V1 requiere una decisión de producto y comunicación separada.
