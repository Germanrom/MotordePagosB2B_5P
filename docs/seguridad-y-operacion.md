# Seguridad y operación

## Variables de entorno

| Variable | Uso |
|---|---|
| `PORT` | Puerto HTTP; por defecto `10000`. |
| `DATABASE_URL` | URL de conexión Prisma de la aplicación. |
| `DIRECT_URL` | URL directa que Prisma usa para migraciones. |
| `APP_BASE_URL` | Host público para callback OAuth V2 y notification URL V2. |
| `MP_CLIENT_ID` | Identificador de la aplicación Mercado Pago OAuth. |
| `MP_CLIENT_SECRET` | Secreto OAuth de la aplicación MP. |
| `MP_WEBHOOK_SECRET` | Secreto para verificar la firma de notificaciones MP. |
| `TOKEN_ENCRYPTION_KEY` | Clave base64 de exactamente 32 bytes para AES-256-GCM. Debe persistir y respaldarse de forma segura. |
| `CORS_ORIGINS` | Lista separada por comas de orígenes de navegador permitidos. Vacío desactiva CORS para navegadores; no bloquea llamadas servidor-servidor. |
| `MI_API_KEY_MAESTRA` | API key del tenant `ENUAR` cuando se ejecuta el seed. No hay valor fallback. |
| `SEED_WEBHOOK_SECRET` | Secreto de callback para `ENUAR` en el seed. |
| `SEED_CALLBACK_URL` | Callback de `ENUAR` usado por el seed. |
| `SEED_REDIRECT_URI` | Redirect de `ENUAR` usado por el seed. |
| `SAAS_SUBSCRIPTIONS_CHECKOUT_ENABLED` | Habilita el alta SaaS solo después de aprobar la fase 0. Por defecto está desactivada. |
| `MP_SAAS_ACCESS_TOKEN_ENCRYPTED` | Token de la cuenta cobradora FivePeaks, cifrado con `TOKEN_ENCRYPTION_KEY`; no es un token OAuth de `Vendor`. |
| `MP_SAAS_COLLECTOR_ID` | User ID de la cuenta FivePeaks para verificar la respuesta de checkout. |
| `MP_SAAS_WEBHOOK_SECRET` | Secreto de firma de webhooks de la integración de suscripciones FivePeaks, separado del webhook de pagos de vendedores. |
| `MP_SAAS_TEST_ACCESS_TOKEN`, `MP_SAAS_TEST_PAYER_EMAIL`, `MP_SAAS_TEST_BACK_URL` | Credenciales y retorno exclusivos del ensayo de fase 0. |

Los valores en `.env.example` son ejemplos. No usar secretos reales en ese archivo ni en Git. Generar API keys aleatorias de alta entropía y entregarlas una sola vez al tenant. La clave de cifrado no debe cambiar sin un proceso de rotación que descifre con la clave anterior y vuelva a cifrar con la nueva.

## Cifrado y firmas

- Tokens de acceso/refresh y secretos callback se cifran con AES-256-GCM (`enc:v1`) en reposo.
- API keys se guardan como SHA-256 hexadecimal y se comparan por hash. La migración gradual acepta temporalmente API keys plaintext mientras existan.
- El webhook entrante verifica `x-signature` con HMAC-SHA256 y comparación en tiempo constante; también limita la antigüedad del timestamp.
- El callback saliente firma el JSON canónico con HMAC-SHA256 y el `webhook_secret` del tenant; las claves de objetos se ordenan recursivamente para que PostgreSQL JSONB no altere la firma.
- No enviar API keys, tokens de MP ni datos de tarjeta a logs o al navegador. El token temporal Brick se manda a MP y no se guarda en `Payment`.
- Express limita los cuerpos JSON a 64 KB, desactiva `X-Powered-By` y agrega `nosniff`, `DENY` para framing, política de referrer restrictiva y permisos de navegador desactivados.
- No hay rate limiting en el proceso. Configurarlo en el proxy o API gateway público con límites adecuados para pagos, OAuth y consulta de estado.

El callback saliente incluye `event_id` estable y cabeceras de idempotencia. No incorpora timestamp en la firma; el receptor debe almacenar los IDs aceptados y deduplicarlos. La firma autentica el contenido, pero por sí sola no resuelve replay.

## Desarrollo local

1. Copiar `.env.example` a `.env` y completar secretos de desarrollo.
2. Levantar PostgreSQL con `docker compose up -d db`.
3. Generar Prisma Client con `npx prisma generate` y aplicar las migraciones locales según corresponda.
4. `npm run dev` inicia `tsx` con nodemon.
5. `npm run build` genera Prisma Client y compila TypeScript; `npm start` inicia `dist/index.js`.

El Compose incluido usa usuario y contraseña de desarrollo y publica el puerto 5432. No reutilizar esa configuración en producción.

## Migración de secretos

1. Crear/proteger y respaldar `TOKEN_ENCRYPTION_KEY` antes del backfill.
2. Ejecutar `npm run db:migrate-credentials` con una conexión a la base correcta.
3. No cambiar la clave ni eliminar el valor previo de la secret manager sin plan de rotación y verificación.
4. Confirmar que las credenciales MP históricas ya tienen prefijo `enc:v1:` y que la API key ya no permanece en claro.

El middleware todavía migra una API key legacy al primer uso. Esta transición no reemplaza el backfill recomendado antes de habilitar V2.

## Health, workers y operación

- `GET /health` es un chequeo de vida del proceso, no de readiness de PostgreSQL o Mercado Pago.
- Los workers de webhooks y callbacks se inician junto con el servidor HTTP.
- Los webhooks fallidos reintentan con espera exponencial hasta una hora entre intentos. Los callbacks fallidos se reintentan de manera indefinida con intervalo máximo de una hora; no existe estado dead-letter ni alerta automática.
- Consultar tablas `WebhookEvent` y `CallbackDelivery` para detectar filas `FAILED` antiguas y `PROCESSING` con lock vencido.
- Para suscripciones, revisar además `SaasWebhookEvent` y `SaasCallbackDelivery`; el worker propio reintenta eventos y callbacks con locks persistidos. Configurar en Mercado Pago el webhook `APP_BASE_URL + /v2/subscriptions/webhook/mercadopago` para los tópicos `subscription_preapproval`, `subscription_authorized_payment` y `payment` de la cuenta FivePeaks.
- El proceso escribe errores con `console.error`; todavía no hay logging estructurado, métricas, trazas ni alertas de negocio.

No ejecutar el backfill ni una migración de producción sin backup, acceso de lectura a conflictos y plan de reversión verificado. La migración agrega constraints; restaurar el backup puede ser necesario si falla un caso de datos no detectado.
