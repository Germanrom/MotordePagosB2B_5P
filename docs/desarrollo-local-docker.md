# Desarrollo local con Docker

En la configuración actual, **Docker ejecuta PostgreSQL** y la API Node/TypeScript se ejecuta en el host con `npm run dev`. No hay un servicio de aplicación en `docker-compose.yml`.

## Requisitos

- Docker Desktop o Docker Engine con Docker Compose.
- Node.js 18 o superior; conviene usar la versión LTS acordada por el equipo.
- npm.

## 1. Preparar configuración

Desde la raíz del repositorio:

```bash
cp .env.example .env
```

Para la base del Compose local, las URLs deben apuntar al host:

```dotenv
DATABASE_URL="postgresql://admin:password@localhost:5432/motor_pagos?schema=public"
DIRECT_URL="postgresql://admin:password@localhost:5432/motor_pagos?schema=public"
PORT=8000
APP_BASE_URL="http://localhost:8000"
```

`TOKEN_ENCRYPTION_KEY` es necesaria para crear tenants, cifrar credenciales y ejecutar OAuth. Generar 32 bytes aleatorios codificados en base64:

```bash
openssl rand -base64 32
```

Copiar la salida en `TOKEN_ENCRYPTION_KEY` dentro de `.env`. Es una clave local de desarrollo; no reutilizarla en staging/producción. No subir `.env` a Git.

Para trabajar solo en endpoints de salud no se necesitan credenciales reales de Mercado Pago. OAuth y webhooks requieren completar además `MP_CLIENT_ID`, `MP_CLIENT_SECRET` y `MP_WEBHOOK_SECRET`.

## 2. Levantar PostgreSQL

```bash
docker compose up -d db
docker compose ps
docker compose logs -f db
```

Compose espera que `pg_isready` confirme que el servicio está sano. La base usa un volumen llamado `postgres_data`, por lo que detener el contenedor no borra los datos.

La configuración de Compose usa usuario/clave de desarrollo y publica PostgreSQL en `localhost:5432`; no usar esos valores fuera de una máquina local.

## 3. Instalar, migrar y arrancar la API

En otra terminal, desde la raíz:

```bash
npm ci
npx prisma generate
npm run db:deploy
npm run dev
```

En una base nueva, `db:deploy` aplica la migración inicial y la migración multi-tenant. Para desarrollo también existe `npm run db:migrate`, que usa `prisma migrate dev`.

Comprobar el servidor:

```bash
curl http://localhost:8000/health
```

Debe responder JSON con `status: "ok"`. Este endpoint comprueba que Express está vivo, no que PostgreSQL o Mercado Pago estén disponibles.

## 4. Crear un tenant de desarrollo

El script genera API key y secreto callback, cifra/hash en la base y muestra ambos una única vez:

```bash
npm run tenant:create -- \
  --client-id ENUAR_LOCAL \
  --callback-url http://localhost:9000/webhooks/fivepeaks \
  --redirect-uri http://localhost:9000/admin/settings
```

El servicio permite HTTP únicamente para `localhost`; para callback remoto se requiere HTTPS. Guardar los valores que imprime el comando en un gestor de secretos local seguro. No hay endpoint público para crear tenants.

También existe `scripts/seed_client.ts` para el tenant fijo `ENUAR`; requiere `MI_API_KEY_MAESTRA`, `SEED_WEBHOOK_SECRET`, `SEED_CALLBACK_URL` y `SEED_REDIRECT_URI` y usa `upsert`.

## 5. Integración con Mercado Pago desde local

El pago Brick requiere una cuenta MP conectada y `APP_BASE_URL` accesible por Mercado Pago para callback OAuth/webhook. `localhost` no es accesible desde MP. Para probar el ciclo completo, usar un túnel HTTPS temporal y:

1. definir `APP_BASE_URL` con ese host;
2. registrar `<APP_BASE_URL>/v2/auth/callback` como redirect URI en la aplicación MP;
3. iniciar OAuth desde `GET /v2/auth/mp-url`;
4. completar el pago de prueba y comprobar los webhooks.

Cuando se cambia `APP_BASE_URL`, volver a verificar que el redirect URI de la aplicación MP sea idéntico. No usar tokens productivos para pruebas locales.

## Comandos útiles

```bash
docker compose ps                 # Estado de PostgreSQL
docker compose logs -f db         # Logs de PostgreSQL
docker compose exec db pg_isready -U admin -d motor_pagos
npx prisma studio                 # Inspeccionar datos localmente
```

## Ejecutar pruebas de integración y E2E

El perfil `test` levanta una segunda base aislada en el puerto `5433`; no comparte datos con la base normal del puerto `5432`.

```bash
docker compose --profile test up -d db-test
export TEST_DATABASE_URL="postgresql://admin:password@localhost:5433/motor_pagos_test?schema=public"
DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DATABASE_URL" npx prisma migrate deploy
npm test
npm run test:integration
npm run test:e2e
```

Las pruebas de integración y E2E rechazan URLs que no apunten a la base `motor_pagos_test`. Las E2E levantan la API y un Mercado Pago simulado en puertos locales; no usan credenciales ni cuentas reales. Sin `TEST_DATABASE_URL`, esas suites se marcan como omitidas. `npm run test:all` ejecuta las tres capas.

`docker compose down` detiene contenedores y conserva el volumen. `docker compose down -v` también elimina `postgres_data` y todos los datos locales; usarlo solo cuando se quiera reiniciar deliberadamente la base.

## Problemas comunes

| Síntoma | Revisión |
|---|---|
| Prisma no conecta | Verificar que `db` esté healthy, puerto `5432` libre y URL con host `localhost` desde el proceso Node en el host. |
| Prisma pide `DIRECT_URL` | Completarlo en `.env`; para Compose local puede ser igual a `DATABASE_URL`. |
| `TOKEN_ENCRYPTION_KEY` inválida | Debe decodificar a exactamente 32 bytes base64. Generar otra para la base local; no cambiar una clave que ya cifró datos que se quieran conservar. |
| OAuth callback no vuelve | Mercado Pago no puede llamar `localhost`; verificar túnel HTTPS, `APP_BASE_URL` y el redirect URI registrado. |
| `npm run tenant:create` dice que ya existe | Elegir un `client_id` de desarrollo nuevo o reutilizar el tenant existente; no volver a crearlo para rotar secretos. |
