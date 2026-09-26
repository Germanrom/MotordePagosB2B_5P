# Preparar Mercado Pago para hacer pruebas

Esta guía es para quien necesita dejar lista una cuenta de Mercado Pago de prueba y comprobar una compra en un sitio de FivePeaks. No requiere programar ni copiar claves.

## Antes de empezar

Pedile al contacto de FivePeaks que te confirme estas tres cosas:

1. Cuál es el **sitio de pruebas**. Debe ser distinto del sitio donde compran clientes reales.
2. Que ese sitio ya está conectado a una **integración de prueba de Mercado Pago** y que podés vincular una cuenta de prueba.
3. Qué producto van a probar. La integración actual de FivePeaks usa **Payment Brick**; para probar tarjeta se usan tarjetas de prueba.

Si no pueden confirmarte que el sitio está preparado para pruebas, frená acá. Crear una cuenta de prueba en Mercado Pago no cambia por sí solo el sitio de FivePeaks a modo de prueba. FivePeaks administra la integración que conecta ambos sistemas.

## 1. Crear una cuenta de vendedor de prueba

1. Entrá a [Mercado Pago Developers](https://www.mercadopago.com.ar/developers/) con tu cuenta habitual.
2. Abrí **Tus integraciones** y elegí la aplicación de FivePeaks que te indicó el equipo.
3. Entrá en **Cuentas de prueba** y elegí **Crear cuenta de prueba**.
4. Seleccioná **Argentina** y el tipo **Vendedor**. Poné una descripción fácil de reconocer, por ejemplo: `Vendedor de pruebas ENUAR`.
5. Guardá en un lugar privado el usuario, la contraseña y el código de verificación que Mercado Pago muestra para la cuenta. Los vas a usar para iniciar sesión durante la vinculación.

La cuenta de prueba tiene saldo ficticio. No uses tu cuenta personal ni una cuenta que reciba pagos reales para esta prueba. Mercado Pago explica este proceso en su guía de [cuentas de prueba](https://www.mercadopago.com.ar/developers/es/docs/automatic-payments-orders/resources/test-accounts).

**¿No ves la aplicación de FivePeaks?** No crees otra aplicación para reemplazarla: la cuenta debe vincularse a la integración preparada para el sitio. Pedile al contacto de FivePeaks que te habilite el acceso o te indique cómo seguir.

## 2. Vincular la cuenta al sitio de prueba

1. Abrí el sitio de pruebas que te compartió FivePeaks.
2. Entrá a la opción para conectar Mercado Pago.
3. Cuando Mercado Pago pida iniciar sesión, usá el usuario y la contraseña de la **cuenta de vendedor de prueba** que acabás de crear.
4. Revisá que estás autorizando la aplicación indicada por FivePeaks y aceptá la conexión.
5. Volvé al sitio. Debería mostrar que Mercado Pago quedó conectado.

No compartas la contraseña, el código de verificación ni claves de Mercado Pago por correo, chat o formularios. Ingresá los datos de la cuenta solamente en la página de Mercado Pago que aparece durante la conexión.

## 3. Hacer una compra con tarjeta de prueba

1. En el sitio de pruebas, iniciá una compra con el importe que te indique el equipo.
2. Cuando aparezca el Payment Brick, completalo con una [tarjeta de prueba de Mercado Pago](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/integration-test/test-payment-flow).
3. Para probar un resultado específico, seguí el escenario que indique el equipo y las instrucciones de Mercado Pago para el nombre del titular. No uses una tarjeta real.
4. Si el formulario pide el correo del comprador, usá uno de prueba y distinto del usuario con el que iniciaste sesión en Mercado Pago.
5. Confirmá la compra y anotá el número de pedido y el resultado que mostró la página.
6. Pasale al equipo el número de pedido y si la página indicó aprobado, pendiente o rechazado. No envíes datos de tarjeta ni contraseñas.

Para probar pagos con tarjeta, Mercado Pago indica usar credenciales de prueba y tarjetas de prueba; el correo del comprador no debe ser el mismo que el usado para iniciar sesión en Mercado Pago. Consultá su [guía oficial de pruebas para Checkout Bricks](https://www.mercadopago.com.ar/developers/es/docs/checkout-bricks/integration-test/test-payment-flow) para ver los datos y escenarios vigentes.

## Si Mercado Pago pide iniciar sesión al pagar

El flujo de tarjeta de Payment Brick normalmente se completa con los datos de una tarjeta de prueba. Si la prueba que preparó FivePeaks redirige a Mercado Pago para pagar con una cuenta, necesitás además una **cuenta de comprador de prueba**, distinta de la cuenta vendedora:

1. En la misma aplicación de prueba, creá otra cuenta desde **Cuentas de prueba** y elegí el tipo **Comprador**.
2. Asegurate de que vendedor y comprador sean de Argentina.
3. Iniciá sesión con esa cuenta solamente en la pantalla de pago de prueba.

No uses la cuenta vendedora como comprador. Si no tenés claro qué tipo de compra estás probando, consultalo con el equipo antes de continuar.

## Qué significan los resultados

- **Aprobado:** Mercado Pago aceptó el pago de prueba.
- **Pendiente:** todavía no hay confirmación final. Avisale al equipo y esperá su revisión.
- **Rechazado:** puede ser el resultado esperado si se estaba probando un rechazo.

La pantalla de regreso confirma lo que se mostró en el navegador; el equipo de FivePeaks verifica el estado final en el sitio de pruebas.

## Si algo sale distinto

- **El sitio abre la experiencia de compra real o pide una tarjeta real:** cerrá la página y avisá al contacto de FivePeaks. No continúes.
- **No aparece la aplicación de FivePeaks en Mercado Pago Developers:** pedí acceso o instrucciones al equipo; no crees otra aplicación.
- **No podés iniciar sesión con el usuario de prueba:** buscá el usuario, contraseña y código de verificación en **Tus integraciones → aplicación → Cuentas de prueba**.
- **El pago queda pendiente o falla:** compartí el número de pedido y el resultado visible. No compartas credenciales ni los datos completos de la tarjeta.

## Importante sobre el ambiente

El sitio de pruebas, la aplicación de Mercado Pago y la cuenta vinculada tienen que estar preparados juntos por FivePeaks. Este repositorio todavía no ofrece un botón para alternar entre pruebas y producción; el equipo debe confirmar previamente que el sitio que te dio usa una configuración de prueba. La guía técnica de estado del proyecto también indica que falta validar el flujo completo con credenciales de sandbox.
