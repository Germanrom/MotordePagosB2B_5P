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