# Compatibilidad V1

V1 continúa montada para que integraciones existentes migren gradualmente. Todas sus rutas `/v1` y el alias `/auth` agregan los encabezados `Deprecation` y `X-API-Deprecation-Info`. No hay fecha de apagado definida.

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

- V1 conserva `vendor_id` para compatibilidad y usa preferencias de Mercado Pago.
- V2 cobra con Payment Brick, no acepta `vendor_id` y usa la cuenta V2 activa del tenant.
- El callback OAuth V1 usa estado compuesto por identificadores del cliente/vendor. No tiene el `state` aleatorio, temporal y de un solo uso de V2.
- El callback V1 sigue teniendo URL de redirect hardcodeada en el controlador. Antes de cambiar dominio, revisar la URL configurada en Mercado Pago y ese controlador.
- Los tokens guardados por nuevas vinculaciones V1 quedan cifrados; los tokens históricos requieren ejecutar el backfill de credenciales.

## Migración recomendada

1. Configurar OAuth V2 y una cuenta cobradora activa por tenant.
2. Actualizar el backend del cliente para llamar a V2 desde servidor y dejar de enviar `vendor_id`.
3. Cambiar callbacks entrantes de pago y validar la firma saliente del motor.
4. Comparar órdenes y pagos observados durante la transición.
5. Mantener V1 hasta completar la migración coordinada; anunciar por separado cualquier fecha de retiro.

No se recomienda quitar los headers de deprecación ni retirar `/auth` sin confirmar las URLs de callback registradas para los clientes existentes.
