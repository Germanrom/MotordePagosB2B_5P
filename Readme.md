## Estado de las APIs

La documentación funcional y técnica detallada está en [docs/README.md](docs/README.md).
Para integrar un sistema cliente, empezar por [la guía de integración](docs/integracion-tenant.md); para desarrollar localmente, seguir [el instructivo Docker](docs/desarrollo-local-docker.md).
Para acompañar una compra de prueba sin instrucciones técnicas, usar [la guía simple de pruebas con Mercado Pago](docs/pruebas-mercado-pago-no-tecnico.md).

- **V2 es la versión activa** para nuevas integraciones. El cobro con Payment Brick está disponible en `POST /v2/pagos/brick`.
- **V1 está deprecated desde el 2026-09-26** y continúa disponible para clientes existentes durante la migración. Sus respuestas incluyen los encabezados HTTP `Deprecation` y `X-API-Deprecation-Info`.
- No se ha definido una fecha de apagado de V1. Se anunciará antes de retirar esas rutas.
- Las rutas y páginas de prueba `/api/poc` fueron retiradas.

## Modelo V2 de pagos

`Client` es la identidad del tenant. En V2, cada tenant tiene como máximo un `Vendor.v2_active`; la API obtiene esa cuenta desde la API key y nunca acepta un selector de cuenta en el pago. Las cuentas antiguas quedan preservadas para V1. Cuando un tenant tiene varias cuentas históricas, debe vincular la cuenta que usará en V2 mediante OAuth.

El `Order` representa la intención de cobro y su `external_id` es único dentro del tenant. Cada solicitud aceptada a Mercado Pago crea o reutiliza un `Payment`, que representa un intento y conserva su estado independiente. Las claves foráneas compuestas impiden asociar accidentalmente una orden, cuenta o pago de otro tenant.

### Vincular Mercado Pago

1. El backend del tenant llama `GET /v2/auth/mp-url` con `X-API-Key`.
2. El usuario autoriza la cuenta MP y Mercado Pago vuelve a `GET /v2/auth/callback`.
3. El estado OAuth aleatorio se persiste con vencimiento y solo se consume una vez. La nueva vinculación queda como única cuenta activa de V2.

Configurar en Mercado Pago el callback `${APP_BASE_URL}/v2/auth/callback`. `APP_BASE_URL`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` y `MP_WEBHOOK_SECRET` deben configurarse como secretos del entorno. `TOKEN_ENCRYPTION_KEY` debe ser una clave base64 de 32 bytes y conservarse para poder descifrar credenciales ya guardadas.

### Crear un pago con Brick

`POST /v2/pagos/brick` requiere `X-API-Key` y `Idempotency-Key`. El API key se usa solo desde el backend del tenant; el frontend debe enviar el token del Brick a su backend, y ese backend debe reenviar los datos al motor. No enviar la API key del motor al navegador.

El body acepta `external_id`, `concepto`, `transaction_amount`, `currency_id` (`ARS`), `token`, `installments`, `payment_method_id`, `issuer_id` opcional y `payer`. Campos desconocidos, incluido `vendor_id`, se rechazan. Repetir clave y contenido devuelve la misma operación; reutilizar la clave con otro contenido devuelve `409`.

El webhook de V2 se configura automáticamente como `/v2/webhook/mercadopago?account_id=<id>`. El motor guarda el evento, verifica la firma, consulta el recurso a MP con el token de la cuenta asociada y compara cuenta cobradora, referencia, importe y moneda antes de actualizar. Las notificaciones al callback del tenant se guardan en una cola durable y se reintentan.

Consultar el estado usa `GET /v2/ordenes/:id/estado`, también autenticado por `X-API-Key`; solo devuelve órdenes del tenant autenticado.

## Migración de datos existente

1. Configurar variables de entorno, incluido `TOKEN_ENCRYPTION_KEY`.
2. Antes de aplicar restricciones de unicidad, ejecutar `npm run db:conflicts`. Resolver externamente cada grupo de `external_id` repetido por tenant y cada orden ligada a una cuenta de otro tenant; el script informa las referencias y no borra ni reasigna datos.
3. Desplegar la migración aditiva `20260926120000_multitenant_payment_model`.
4. Ejecutar `npm run db:migrate-credentials` para hashear API keys y cifrar secretos/tokens existentes. Guardar una copia segura y protegida de la clave de cifrado.
5. Solo los tenants con una cuenta histórica quedan marcados automáticamente como candidatos V2. Para tenants con varias, completar OAuth para seleccionar la cuenta cobradora activa.
6. Mantener `/v1`, `/auth` y sus webhooks durante la transición. V1 conserva el selector histórico de vendor; no hay fecha de apagado anunciada.

No se implementan en este alcance suscripciones recurrentes, `/preapproval` ni comisiones/split por pago.

```mermaid
%% Flujo histórico de V1/Checkout Pro; para el contrato vigente ver docs/api-v2.md.
sequenceDiagram
    autonumber
    actor Vendedor as Dueño del Local
    participant SistemaCliente as Sistema de tu Cliente (B2B)
    participant Motor as Tu Motor de Pagos (Render)
    participant DB as Supabase (BD)
    participant MP as Mercado Pago (API)
    actor Comprador as Cliente Final

    box rgb(230, 240, 255) FASE 1: Vinculación del Vendedor (Onboarding OAuth 2.0)
        SistemaCliente->>Motor: GET /auth/mp-url?client_id=... (Header: X-API-Key)
        Motor->>SistemaCliente: Retorna JSON con auth_url
        SistemaCliente->>Vendedor: Muestra botón/Redirige al link de MP
        Vendedor->>MP: Inicia sesión y hace clic en "Permitir"
        MP->>Motor: Redirige a /auth/callback?code=...&state=...
        Motor->>DB: Busca al Cliente usando el "state"
        Motor->>MP: POST /oauth/token (Intercambia code por access_token)
        MP->>Motor: Retorna APP_USR-... (Token de Producción)
        Motor->>DB: Crea/Actualiza Vendedor guardando el Token
        Motor->>SistemaCliente: Dispara Webhook notificando vinculación exitosa
        Motor->>Vendedor: Redirige al redirect_uri del frontend de tu Cliente
    end

    box rgb(230, 255, 230) FASE 2: Creación de la Orden (Checkout)
        SistemaCliente->>Motor: POST /ordenes (Monto, vendor_id. Header: X-API-Key)
        Motor->>DB: Valida credenciales y crea Orden en estado PENDING
        Motor->>MP: POST /checkout/preferences (Firma con el token del vendor_id)
        MP->>Motor: Retorna Preference ID y el init_point
        Motor->>DB: Actualiza la fila de la Orden con el checkout_url
        Motor->>SistemaCliente: Retorna JSON con id_orden y checkout_url
        SistemaCliente->>Comprador: Envía link por mail/WhatsApp o muestra en pantalla
    end

    box rgb(255, 240, 230) FASE 3: Pago y Confirmación (Webhook de Transacción)
        Comprador->>MP: Abre el link, ingresa su tarjeta y paga
        MP->>Comprador: Pantalla verde ("¡Listo! Se acreditó tu pago")
        MP-->>Motor: POST /webhook?vendedor_id=... (Aviso silencioso de pago)
        Motor->>MP: GET /v1/payments/{id} (Consulta estado REAL del pago)
        MP->>Motor: Responde status: "approved"
        Motor->>DB: Actualiza estado de la Orden a APPROVED
        Motor->>SistemaCliente: Dispara Webhook HMAC notificando cobro exitoso
        MP->>Comprador: Redirige automáticamente al back_url (success)
    end
```
