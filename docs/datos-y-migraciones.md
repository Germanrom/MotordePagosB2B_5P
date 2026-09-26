# Datos y migraciones

## Modelos

| Modelo | Significado | Restricciones relevantes |
|---|---|---|
| `Client` | Tenant/sistema integrado, por ejemplo `ENUAR`. | `client_id` único; `api_key_hash` único; `api_key` legado nullable; callback, redirect y secreto de firma. |
| `Vendor` | Cuenta Mercado Pago conectada. | Pertenece a un `Client`; conserva tokens, MP user ID, public key, expiración y bandera `v2_active`. Índice parcial impide más de una cuenta activa V2 por tenant. |
| `Order` | Intención de cobro. | Importe `Decimal(18,2)`; referencia externa única por tenant; cuenta y tenant identificados juntos. |
| `Payment` | Intento individual de pago. | Clave idempotente única por tenant; clave idempotente MP y payment ID MP únicos; relaciones compuestas a la orden y cuenta del mismo tenant. |
| `OAuthState` | Estado OAuth hash, temporal y consumible una vez. | Hash único, tenant propietario, vencimiento y fecha de consumo. |
| `WebhookEvent` | Evento MP recibido y su estado de procesamiento. | Request ID único; tenant y cuenta cobradora relacionados; contador, lock, próximo intento y error. |
| `CallbackDelivery` | Callback de pago pendiente o enviado. | Clave de transición única; tenant y pago relacionados; payload/firma persistidos; contador, lock y fecha de próximo intento. |

Las columnas `Order.mp_payment_id` y `Order.last_payment_id` se mantienen por compatibilidad/lectura rápida. La tabla `Payment` es el historial de intentos. `last_payment_id` todavía no tiene una FK que pruebe en PostgreSQL que apunte a un pago de esa misma orden.

## Migración aditiva

La migración `20260926120000_multitenant_payment_model` conserva clientes, vendors y órdenes; agrega hashes, datos de cuentas, precisión monetaria, tablas de OAuth, pagos, eventos y callbacks. No elimina cuentas MP históricas.

Antes de aplicarla, el script `npm run db:conflicts` informa:

- grupos de órdenes con `external_id` repetido dentro del mismo tenant, incluyendo sus IDs;
- órdenes que apuntan a un vendor cuyo tenant no coincide;
- tenants con más de una cuenta histórica.

La migración aborta si detecta referencias duplicadas o cruzadas. No reasigna ni elimina filas. Resolver cada caso con el responsable funcional y guardar el criterio aplicado.

Solo queda activa automáticamente una cuenta cuando el tenant tiene exactamente un vendor y el token almacenado no está vacío. Esto es una candidatura, no una prueba de validez contra Mercado Pago. La identidad/token se verifica en el primer pago; tenants con múltiples cuentas deben volver a vincular la deseada con OAuth V2.

## Orden operativo

1. Hacer backup verificado de PostgreSQL y confirmar restauración disponible.
2. Configurar `DATABASE_URL`, `DIRECT_URL`, `TOKEN_ENCRYPTION_KEY`, `APP_BASE_URL`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET` y `MP_WEBHOOK_SECRET`.
3. Construir/generar Prisma Client y ejecutar `npm run db:conflicts` contra la base que se va a migrar.
4. Resolver conflictos y ejecutar `npx prisma migrate deploy`.
5. Ejecutar `npm run db:migrate-credentials` una vez para hashear API keys existentes y cifrar webhook secrets y tokens.
6. Revisar que las claves de tenant autentiquen, que las credenciales MP se descifren y que `v2_active` refleje el onboarding previsto.
7. Habilitar llamadas V2 y comprobar webhook MP y callback saliente de punta a punta en staging antes de producción.

El backfill es idempotente respecto a valores con prefijo `enc:v1:` y a API keys ya migradas. La clave de cifrado no se almacena en PostgreSQL; si se pierde, no se podrán recuperar los tokens ya cifrados.

`npm run db:migrate` usa `prisma migrate dev` y es para desarrollo. En ambientes desplegados, usar `npm run db:deploy` (`prisma migrate deploy`).
