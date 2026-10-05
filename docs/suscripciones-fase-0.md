# Fase 0: comprobar el calendario de suscripciones

**Estado: pendiente de ejecución con una cuenta de prueba FivePeaks.** No hay credenciales de prueba configuradas en este repositorio. Esta prueba es una condición para habilitar el alta de suscripciones en producción.

## Hipótesis a comprobar

Mercado Pago debe cobrar el importe completo cuando el pagador autoriza el alta y programar la primera renovación para el primer día 5 que ocurra al menos un mes después de ese cobro. En particular:

| Fecha local del primer cobro | Primera renovación requerida |
|---|---|
| 4 de abril | 5 de mayo |
| 30 de abril | 5 de junio |

La documentación muestra `billing_day: 5` y `billing_day_proportional: false` en planes mensuales, pero no prueba que el checkout pendiente cobre de inmediato y respete simultáneamente esas dos fechas. También debe comprobarse que el checkout alojado acepte crear una suscripción vinculada a un plan sin `card_token_id`: la documentación de planes asociados describe un flujo autorizado con token de tarjeta. Si ese flujo no funciona, evaluar el checkout sin plan y el cambio de día de facturación vía API antes de elegir la implementación. [Crear plan](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval-plan/post), [crear suscripción](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post), [gestión](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/subscription-management).

## Preparación

Usar un vendedor de prueba FivePeaks y un pagador de prueba distinto. Configurar `MP_SAAS_TEST_ACCESS_TOKEN`, `MP_SAAS_TEST_PAYER_EMAIL` y `MP_SAAS_TEST_BACK_URL` en un entorno local seguro. El script exige un token `TEST-` y nunca imprime la credencial. No reutilizar credenciales OAuth de `Vendor`.

```bash
npm run subscriptions:probe -- create-plan 100.00
npm run subscriptions:probe -- create-checkout <plan-id>
```

Abrir `init_point` con el pagador de prueba y completar la autorización. Si Mercado Pago rechaza `create-checkout` por exigir `card_token_id`, registrar el error como resultado de la prueba; no pasar a producción con otro flujo sin comprobar su calendario y primer cobro.

Para comprobar la alternativa sin plan asociado, ejecutar `create-checkout-no-plan 100.00`, autorizar en el checkout y luego `set-billing-day <preapproval-id>`. Este último comando cambia el recurso de prueba en Mercado Pago; comparar `next_payment_date` antes y después y volver a consultar las facturas. La actualización del día de facturación no se considera válida hasta verificar que no generó un cargo anticipado.

Consultar luego, y nuevamente después de cada intento de cobro:

```bash
npm run subscriptions:probe -- inspect <preapproval-id>
```

El comando consulta `/preapproval/{id}` y `/authorized_payments/search`; guardar la salida en un registro de prueba con el momento de consulta. Comprobar el pago concreto con `/v1/payments/{id}` antes de marcarlo como aprobado. Mercado Pago documenta eventos distintos para `subscription_preapproval`, `subscription_authorized_payment` y `payment`; deben observarse los tres en el webhook de prueba. Confirmar con el proveedor el método de registro de la URL de notificaciones de suscripciones, ya que su documentación distingue ese caso de la configuración común de webhooks. [Webhooks de Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/prestashop/additional-content/your-integrations/notifications/webhooks), [factura autorizada](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-authorized-payment/get).

## Registro de resultados

Completar una fila por caso y adjuntar los JSON de consulta, con datos personales redactados:

| Caso | Fecha/hora del alta y zona | Importe del primer pago | Estado/fecha de aprobación del pago | `next_payment_date` | Fecha de la segunda factura | ¿Cumple? |
|---|---|---:|---|---|---|---|
| Alta el día 4 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| Alta el día 30 | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |
| Pago inicial rechazado | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente | Pendiente |

La prueba de los días 4 y 30 requiere ejecutar el checkout en esas fechas o disponer de una simulación de fechas confirmada por Mercado Pago. Cambiar `start_date` de una solicitud no demuestra por sí solo cuándo se cobró realmente el alta. Si el entorno de prueba no permite acelerar el calendario, pedir confirmación del proveedor y mantener este criterio como pendiente.

## Criterio de salida

Se aprueba la fase 0 solo con evidencia de autorización, primer pago completo, fecha de la próxima factura y ausencia de un segundo cargo anticipado para el alta del día 30. Si Mercado Pago no ofrece esa secuencia, ajustar la regla de negocio o diseñar otro mecanismo de cobro recurrente antes de habilitar el endpoint de alta.
