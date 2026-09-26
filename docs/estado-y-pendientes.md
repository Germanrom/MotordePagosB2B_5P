# Estado de implementación y pendientes

Este documento diferencia lo que está en el código de lo que todavía hace falta para considerar el motor listo para operar con confianza. El estado es una revisión de código, no una certificación PCI ni una validación de producción.

## Implementado en la rama

- V2 está montada para nuevas integraciones; V1 sigue viva con headers de deprecación y alias `/auth`.
- Las rutas/página de prueba `/api/poc` se retiraron.
- Middleware de API key compartido entre V1 y V2; hash de API keys con fallback de transición desde texto plano.
- Tenant persistido como `Client`; `Vendor` conserva el nombre y los registros históricos.
- Una cuenta V2 activa por tenant mediante `v2_active` e índice parcial.
- OAuth V2 usa state aleatorio, persistido como hash, vencimiento de 10 minutos y consumo de un solo uso.
- Token y secreto de callback cifrados con AES-256-GCM; seed sin secretos fallback.
- Endpoint Brick estricto, importe decimal, `external_id` por tenant y claves de idempotencia del tenant/proveedor.
- Separación de `Order` y `Payment`, relaciones compuestas y consulta de estado tenant-scoped.
- Webhook entrante persiste el evento, verifica firma, consulta MP con la cuenta asociada y compara collector, referencia, importe y moneda.
- Reintentos persistidos para webhooks y callback de pagos.
- Callback de pago con `event_id` estable en body/cabeceras para permitir deduplicación del receptor.
- Los estados desconocidos de Mercado Pago se dejan sin normalizar y se reintentan desde el evento; no se convierten en `PENDING` ni pisan un estado terminal.
- Límite de 64 KB para JSON y headers HTTP básicos de seguridad.
- Contrato V2 publicado en OpenAPI 3.1.
- Informe de conflictos previo a migración y backfill de secretos.
- README y documentación técnica/funcional actualizados; 30 pruebas unitarias, 6 de integración y 5 E2E ejecutadas localmente con PostgreSQL de prueba y Mercado Pago simulado.

## Antes de una primera puesta en producción

1. **Resolver y ensayar migración:** ejecutar `db:conflicts` en una copia de la base; revisar duplicados de referencias y órdenes ligadas al tenant equivocado; practicar migración y backfill sobre staging restaurado desde backup.
2. **Configurar infraestructura:** establecer todas las variables secretas; registrar `/v2/auth/callback` y `/v2/webhook/mercadopago`; declarar `CORS_ORIGINS` si un navegador necesita hablar con una API pública de lectura.
3. **Revisar cuentas por tenant:** completar OAuth V2 para cada tenant con más de una cuenta histórica y probar que el collector del pago sea el esperado.
4. **Ensayar fallos:** probar una caída temporal de MP, callback indisponible, webhook repetido, firma inválida, tenant/cuenta/importe/referencia cruzados y recuperación tras reiniciar el proceso.
5. **Definir atención operativa:** quién revisa filas fallidas, alertas, respaldos, vencimiento de credenciales y solicitudes de re-vinculación.

No se aplicó la migración a una base real durante esta implementación.

## Pendientes priorizados

### P0 — Cerrar antes de tráfico real

- Incorporar `npm run test:all` en CI con PostgreSQL de prueba y conservar los artefactos/logs del job. Las suites locales cubren aislamiento, constraints, OAuth de un solo uso, idempotencia concurrente, webhook y entrega durable de callbacks.
- Validar el contrato OpenAPI en CI y mantenerlo sincronizado con cambios en rutas y esquemas.
- Ejecutar el flujo completo con credenciales de sandbox MP y callback de un tenant; luego repetir con configuración de producción controlada.
- Establecer alertas y un procedimiento de revisión/reprocesamiento para eventos y callbacks que fallen. Los workers hoy reintentan, pero no notifican a un operador.
- Verificar los estados soportados contra el flujo sandbox actual de MP y documentar cómo incorporar estados nuevos. Los desconocidos quedan como evento fallido para reintento; el pago no se degrada.
- Integrar y documentar en clientes reales la persistencia/deduplicación de `event_id`; los headers ya se emiten, pero el motor no controla el almacenamiento del receptor.
- Añadir rate limiting distribuido en el reverse proxy o gateway antes de exposición pública. El proceso añade headers básicos y limita el JSON, pero no implementa un contador de rate distribuido.

### P1 — Endurecimiento y compatibilidad

- Implementar refresh seguro de access tokens usando `mp_refresh_token`, o definir una política operativa de re-vinculación antes de expiración. El código actual bloquea nuevos pagos si `mp_expires_at` venció.
- Cambiar OAuth V1 a un flujo de salida controlada: aún construye `state` predecible y callback URL hardcodeada. V1 sigue deprecated, pero estos endpoints continúan activos.
- Hacer durable el callback de vinculación OAuth; actualmente su fallo solo se registra y no se reintenta.
- Resolver la carrera entre dos OAuth simultáneos que intenten asociar la misma cuenta MP a tenants diferentes. El chequeo `linkedElsewhere` está en aplicación, pero `mp_user_id` no tiene unicidad global de base para preservar compatibilidad con V1.
- Agregar FK compuesta para `Order.last_payment_id` y definir checks/enum para estados e importes. Hoy `last_payment_id` es una columna de lectura rápida sin relación referencial.
- Definir rotación de `TOKEN_ENCRYPTION_KEY` y versionado de claves; `enc:v1` identifica formato, no una clave seleccionable para rotación.
- Ajustar/confirmar las URL de retorno del Checkout Pro V1 y eliminar dominios hardcodeados del controlador V1.

### P2 — Operación y evolución

- Añadir readiness real de base de datos y Mercado Pago separado del liveness actual.
- Agregar logging estructurado, métricas de latencia/tasa de errores, profundidad/edad de colas y trazabilidad por tenant, order, payment y webhook event.
- Definir retención y limpieza de estados OAuth expirados, eventos, callbacks y datos personales.
- Considerar extraer workers a procesos dedicados si escala el tráfico; hoy los locks PostgreSQL permiten coordinar múltiples instancias HTTP, pero los workers comparten recursos con la API.
- Cuando el producto lo requiera, diseñar un módulo de suscripciones independiente: suscripciones a FivePeaks cobran en la cuenta propia de FivePeaks; suscripciones ofrecidas por un tenant cobran en la cuenta MP de ese tenant. No agregar split/commission ni `/preapproval` sin decisión de negocio y conciliación específica.

## Verificaciones disponibles

- `npm test`: 30 pruebas unitarias de cifrado, hashes, firmas, reconciliación, estados y validación Brick.
- `npm run test:integration`: 6 pruebas PostgreSQL para constraints, OAuth, aislamiento de tenants y concurrencia de idempotencia.
- `npm run test:e2e`: 5 recorridos HTTP, incluyendo OAuth, pago Brick, webhook y callback saliente; Mercado Pago se simula localmente.
- `npm run test:all`: ejecuta las tres capas; requiere `TEST_DATABASE_URL` para no omitir integración y E2E de pago.
- `npx tsc --noEmit`: chequeo TypeScript.
- `npx prisma validate`: validación de sintaxis/modelos Prisma.
- `npm run db:conflicts`: informe de datos antes de restricciones.
- `npm run db:migrate-credentials`: backfill de hashes y cifrado.

Las tres primeras comprobaciones no reemplazan la prueba de migración sobre una copia realista de la base ni las pruebas de sandbox de Mercado Pago.
