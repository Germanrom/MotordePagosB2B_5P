# Motor de Pagos FivePeaks

API multi-tenant que conecta plataformas cliente con Mercado Pago. Cada tenant opera con su propia API key y una cuenta de Mercado Pago vinculada; el motor registra las órdenes, procesa los pagos y reconcilia sus estados mediante webhooks.

## Estado

- **V1 crea links de pago** con preferencias de Checkout Pro y devuelve `checkout_url`.
- **V2 procesa pagos con Payment Brick** cuando la experiencia de pago ocurre dentro de la plataforma integrada.
- Ambas versiones están activas; V1 no se anuncia como obsoleta.
- `/api/poc` fue retirado.
- Las suscripciones recurrentes y las comisiones por transacción están fuera del alcance actual.

## Empezar

- Quiero integrar mi plataforma: [guía de integración de un tenant](docs/integracion-tenant.md).
- Quiero preparar una cuenta de Mercado Pago para pruebas: [guía para ambiente no productivo](docs/pruebas-mercado-pago-no-tecnico.md).
- Quiero levantar el proyecto localmente: [instructivo con Docker](docs/desarrollo-local-docker.md).
- Quiero consultar el índice de documentación: [docs/README.md](docs/README.md).

## Modelo de pagos

- `Client` identifica al tenant o sistema integrado, por ejemplo ENUAR. Varias páginas del mismo sistema pueden compartirlo.
- `Vendor` representa una cuenta de Mercado Pago vinculada. En V2, el motor elige la cuenta activa del tenant.
- `Order` registra la intención de cobro y `Payment` cada intento realizado ante Mercado Pago.
- Mercado Pago confirma el estado al motor mediante un webhook; el motor notifica el resultado al tenant.

## Desarrollo local

La infraestructura local usa PostgreSQL en Docker y ejecuta la API en el host. Seguí [el instructivo local](docs/desarrollo-local-docker.md) para configurar variables, iniciar la base y levantar el servidor.

## Documentación histórica

El detalle de las rutas y diferencias entre V1 y V2 está en [docs/compatibilidad-v1.md](docs/compatibilidad-v1.md). El análisis previo del sistema está en [analysis_motor_pagos.md](analysis_motor_pagos.md) y no describe necesariamente el comportamiento actual.
