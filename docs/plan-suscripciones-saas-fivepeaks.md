# Plan de cobro de suscripciones SaaS de FivePeaks

## Objetivo y decisiones

FivePeaks cobrará los planes de los tenants de cada app integrada desde su propia cuenta de Mercado Pago. Por ejemplo, VALIKT puede tener muchos tenants onboardeados; cada suscripción se identifica por la app y el ID externo del tenant.

- Cada app mantiene su catálogo de planes y decide cómo un impago afecta el acceso a su tenant.
- FivePeaks inicia la suscripción, registra los cobros y notifica sus resultados. No habilita ni suspende servicios de la app.
- El alta usa checkout alojado de Mercado Pago. La app redirige al tenant al `init_point`; Brick no programa cobros recurrentes.
- Cada app configura una URL backend para notificaciones de suscripciones. La URL de retorno del checkout es distinta y solo sirve para la navegación del usuario.
- Hay un plan vigente por app y tenant. Los cambios de plan y cancelaciones se aplican al período siguiente, sin prorrateo.
- El primer cobro completo ocurre cuando se aprueba el alta. Las renovaciones quedan en el día 5, en el primer día 5 que ocurra al menos un mes después del primer cobro. Ejemplo: alta cobrada el 4 de abril → 5 de mayo; alta cobrada el 30 de abril → 5 de junio.

## Entrega por fases

### Fase 0 — Validar el calendario de Mercado Pago

Hacer una prueba en sandbox con checkout alojado para confirmar autorización, primer cobro, `next_payment_date` y renovación fija el día 5. Cubrir altas cobradas los días 4 y 30, y verificar que la segunda no genere otro cargo a los cinco días. No avanzar a cobros productivos hasta confirmar esta regla con el proveedor.

**Entrega:** flujo de prueba documentado con los resultados y fechas que devuelve Mercado Pago.

### Fase 1 — Alta y enlace de checkout

Agregar un dominio y persistencia de suscripciones separado de `Order` y `Payment`. Exponer a la app una operación autenticada para iniciar una suscripción con tenant externo, código/versión del plan, importe, moneda y email del pagador. Guardar una copia de los términos aceptados y devolver el `init_point` de Mercado Pago. La suscripción queda pendiente hasta confirmación del proveedor.

**Entrega:** la app puede iniciar un alta y el tenant puede completar la autorización en Mercado Pago.

### Fase 2 — Activación y notificación a la app

Recibir y validar las notificaciones de suscripción y pago de Mercado Pago, consultar el estado real al proveedor y confirmar el primer cobro. Persistir los eventos de forma idempotente y entregar callbacks firmados a la URL de suscripción configurada por la app, con reintentos durables.

**Entrega:** la app recibe una confirmación backend verificable del alta y del primer pago; el retorno del navegador nunca basta para activar la suscripción.

### Fase 3 — Renovaciones y cobros fallidos

Registrar cada período cobrado e informar pagos aprobados, rechazados y recuperados después de reintentos. Mercado Pago administra los reintentos del medio de pago; FivePeaks comunica los hechos y la app define su política de acceso o gracia.

**Entrega:** la app puede reconocer qué tenant y período se pagó o quedó impago, sin cargos ni callbacks duplicados por notificaciones repetidas.

### Fase 4 — Consulta, cambios y cancelación

Permitir consultar estado y próximo vencimiento, programar cambios de plan para el próximo período y cancelar futuras renovaciones conservando el acceso que corresponda al período ya pagado.

**Entrega:** la app puede operar el ciclo de vida de una suscripción sin intervenir manualmente en la cuenta de Mercado Pago.

## Límites técnicos

- Usar credenciales de Mercado Pago propias de FivePeaks, cifradas y separadas de las credenciales OAuth de los vendedores (`Vendor`).
- Mantener suscripciones, períodos de cobro, eventos entrantes y entregas de callbacks en modelos propios; las entidades actuales de órdenes, pagos y webhooks están vinculadas a vendedores.
- Tratar las notificaciones del proveedor como disparadores para consultar y reconciliar el recurso en Mercado Pago. Procesar eventos entrantes y callbacks de forma idempotente.
- El callback de la app informa resultados; cada app decide si mantiene acceso, aplica gracia, limita o suspende a su tenant.

## Casos de aceptación principales

- Alta aprobada, pago inicial rechazado, retorno de navegador sin pago confirmado y renovación mensual aprobada/rechazada/recuperada.
- Fechas de alta los días 4 y 30, con renovación el día 5 según la regla definida.
- Notificaciones de Mercado Pago repetidas, tardías o recuperadas sin duplicar el período cobrado ni el callback lógico.
- Cambio de plan y cancelación efectivos desde el período siguiente; FivePeaks no cambia por sí mismo el acceso de una app.

## Referencias de Mercado Pago

- [Crear una suscripción (`/preapproval`)](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post)
- [Monto proporcional y día de facturación](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-customization/payment-methods/proportional-amount)
- [Gestión de suscripciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management)
