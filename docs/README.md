# Documentación del Motor de Pagos FivePeaks

Este directorio reúne la descripción funcional, técnica y operativa del motor. La fuente de verdad para las rutas desplegadas está en `src/index.ts` y `src/routes/`; cuando cambie el código, actualizar la documentación correspondiente.

## Guías

| Documento | Contenido |
|---|---|
| [Visión funcional](./vision-funcional.md) | Propósito, actores, conceptos de negocio, flujos y estados de pago. |
| [Arquitectura técnica](./arquitectura.md) | Componentes, límites entre rutas/controladores/servicios, datos y diagramas. |
| [API V2](./api-v2.md) | OAuth, pagos Brick, consulta de órdenes, webhooks y callbacks. |
| [Contrato OpenAPI V2](./openapi-v2.yaml) | Especificación OpenAPI 3.1 para clientes y herramientas. |
| [Integración de un tenant](./integracion-tenant.md) | Alta de Client, conexión OAuth, configuración del Brick y callbacks. |
| [Preparar Mercado Pago para pruebas](./pruebas-mercado-pago-no-tecnico.md) | Crear una cuenta vendedora de prueba, vincularla al sitio y hacer una compra simulada sin conocimientos técnicos. |
| [Entorno local con Docker](./desarrollo-local-docker.md) | PostgreSQL local en Docker y API ejecutándose en el host. |
| [Compatibilidad V1](./compatibilidad-v1.md) | Contrato de links de pago Checkout Pro y diferencias con V2/Brick. |
| [Datos y migraciones](./datos-y-migraciones.md) | Modelos Prisma, restricciones, migración aditiva y carga de credenciales. |
| [Seguridad y operación](./seguridad-y-operacion.md) | Configuración, ejecución, despliegue, secretos, workers y respuesta operativa. |
| [Estado y pendientes](./estado-y-pendientes.md) | Qué está implementado, qué requiere preparación y prioridades para endurecer el sistema. |
| [Plan de suscripciones SaaS](./plan-suscripciones-saas-fivepeaks.md) | Objetivo y fases para cobrar planes de apps integradas. |
| [Prueba del calendario de suscripciones](./suscripciones-fase-0.md) | Ensayo de primer cobro y renovación el día 5. |
| [Contrato propuesto de suscripciones](./suscripciones-contrato-api.md) | API y callbacks previstos para el módulo SaaS. |

## Estado documental

La documentación describe el código presente en la rama `feat/fix-code-base` al 26 de septiembre de 2026. No afirma que la migración ya se haya aplicado en producción ni que Mercado Pago haya sido probado con credenciales reales.

El análisis histórico de la raíz, [analysis_motor_pagos.md](../analysis_motor_pagos.md), corresponde a una versión anterior del sistema. Para el comportamiento actual, usar primero los documentos de este directorio.
