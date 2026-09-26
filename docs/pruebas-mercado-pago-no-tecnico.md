# Probar Mercado Pago sin cobrar dinero real

Esta guía es para la persona que acompaña una prueba de compra. No hace falta programar ni copiar claves en una página.

## Antes de empezar

Pedile al equipo de FivePeaks o de tu plataforma estas tres cosas:

1. El enlace del sitio de pruebas.
2. La confirmación de que tu plataforma está conectada al entorno de pruebas de Mercado Pago.
3. Los datos de una tarjeta de prueba y el importe que hay que probar.

Usá solamente datos de prueba. No ingreses una tarjeta real ni hagas la prueba desde la página de producción.

## Hacer una compra de prueba

1. Abrí el enlace de pruebas que te compartió el equipo.
2. Elegí un producto o una compra de prueba y avanzá hasta el formulario de Mercado Pago.
3. Si aparece una pantalla para conectar una cuenta, iniciá sesión con la cuenta que el equipo indicó para pruebas y aceptá la conexión. Revisá que la dirección del navegador sea la del entorno de pruebas.
4. Completá el formulario con los datos de la tarjeta de prueba que te dieron. No uses los datos de una tarjeta personal.
5. Confirmá la compra y esperá el resultado. No cierres la página mientras Mercado Pago la procesa.
6. Avisale al equipo si la compra quedó aprobada, pendiente o rechazada. Compartí el número de pedido que muestra la página; nunca compartas claves ni datos completos de tarjeta.

Si el formulario pide el email del comprador, no uses el email con el que iniciás sesión en Mercado Pago. Para un pago con tarjeta, Mercado Pago pide un email distinto y una tarjeta de prueba. Si la compra te redirige a iniciar sesión en Mercado Pago, el equipo debe darte una cuenta de prueba compradora.

## ¿Qué resultado debería ver?

La pantalla puede mostrar **aprobado**, **pendiente** o **rechazado** según el escenario elegido. El equipo técnico confirma el estado final en el sistema de pruebas. La pantalla de regreso por sí sola no confirma que el pago haya quedado acreditado.

Para probar los tres resultados, pedile al equipo una tarjeta de prueba o un nombre de titular preparado para cada escenario. Mercado Pago publica tarjetas de prueba y explica cómo seleccionar resultados para Payment Brick en su [guía oficial de compras de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/integration-test/test-payment-flow).

## Si algo falla

- **No aparece Mercado Pago:** confirmá que abriste el enlace de pruebas y pedile al equipo que revise la conexión de la cuenta.
- **La compra se rechaza:** puede ser el resultado esperado. Confirmá con el equipo qué escenario estaban probando.
- **La página queda pendiente:** avisale al equipo con el número de pedido; algunos medios tardan más en confirmar.
- **Te pide una tarjeta real:** detené la prueba y pedí el enlace y los datos correctos para pruebas.

## Palabras simples

- **Entorno de pruebas:** copia del sitio usada para probar antes de habilitar compras reales.
- **Cuenta de prueba:** usuario de Mercado Pago destinado a ensayos.
- **Tarjeta de prueba:** número publicado por Mercado Pago para simular una compra; no pertenece a una persona.
- **Conectar cuenta:** autorizar a la plataforma a cobrar en nombre de la cuenta elegida. La clave privada no se comparte durante este paso.

Mercado Pago puede pedir datos diferentes según el medio de pago. Su [guía de Checkout Bricks](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/integration-test/test-payment-flow) explica qué usar para tarjetas y pagos con redirección; la [guía de tarjetas de prueba](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/integration-test/cards) detalla los resultados simulados.
