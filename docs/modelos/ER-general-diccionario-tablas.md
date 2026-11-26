# Diccionario de datos — Modelo ER general

**Proyecto:** Aforo · Plataforma de gestión de eventos  
**Modelo físico:** `ER-general.pdm` (PowerDesigner, PostgreSQL 16)  
**Diagrama:** `img/ER_general.png` y `img/ER_general.emf`  
**Documento:** solo diccionario de tablas y columnas

## Convenciones

| Símbolo | Significado |
|---|---|
| `PK` | Clave primaria. |
| `FK` | Clave foránea. |
| `AK` | Clave alternativa (`UNIQUE`). |
| `0..1` | Cero o uno. |
| `0..*` | Cero o muchos. |

La columna **Clave** resume PK, FK y AK. Las FK se detallan debajo de cada tabla; el tipo de relación (`física` o `lógica`) indica si cruza o no la base de datos de un servicio.

**Roles y personas.** `personas` guarda los datos personales y `usuarios` solo las credenciales (1 persona : 0..1 usuario). Los roles son la tabla `roles` y se asignan mediante `usuario_roles` (N:M, sin parejas repetidas). La vista `cuentas` une las tres para el inicio de sesión; por ahora la aplicación usa un rol vigente por usuario. El nombre del asistente se copia en `tickets.titular` como snapshot del comprobante.

**Réplica de checkin.** `checkin` mantiene una réplica local de `tickets` para operar sin conexión. En este modelo consolidado, `tickets` e `ingresos` se muestran juntos y la relación se marca como lógica.

**Referencias lógicas sin línea en el diagrama:**

- `cupos.evento_id` → `eventos.id` (redundante con `cupos.tipo_entrada_id`).
- `reservas.orden_id` → `ordenes.id` (se completa al crear la orden; se omite para no dibujar un ciclo con `ordenes.reserva_id`).
- `ingresos.evento_id` → `eventos.id` (redundante con `ingresos.tid`).
- `reportes_eventos.organizador_id` → `usuarios.id` (proyección de reports).

## Tablas

Se incluyen las 19 tablas de negocio del ER general. Las tablas técnicas `outbox` y `mensajes_procesados` viven en `ER-comun.pdm` y no forman parte de este diccionario.

### `personas`

**Servicio:** `auth` · **Laboratorio 01**  
**Propósito:** datos personales, independientes de las credenciales; una persona puede no tener cuenta (RF03)

**Clave primaria:** `id`

**Claves únicas:** `identificacion` (AK_personas_1; admite nulos: el registro web no la pide)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `nombres` | `text` | No | — | — | Nombres (o razón social de un organizador). |
| `apellidos` | `text` | Sí | — | — | Apellidos. |
| `identificacion` | `text` | Sí | AK | — | Cédula, RUC o pasaporte. |
| `correo` | `text` | No | — | — | Correo de contacto. |
| `telefono` | `text` | Sí | — | — | Teléfono de contacto. |
| `estado` | `boolean` | No | — | `true` | Activa o inactiva. |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de creación. |

### `usuarios`

**Servicio:** `auth`  
**Propósito:** credenciales de acceso y bloqueo por intentos fallidos (RF01, RNF05)

**Clave primaria:** `id`

**Claves únicas:** `correo` (AK_usuarios_1), `persona_id` (AK_usuarios_2)

**Claves foráneas:**

- `persona_id` → `personas.id` (0..1, física): cada usuario corresponde a una sola persona y no la comparte

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `persona_id` | `uuid` | No | FK, AK | — | Persona dueña de la cuenta. |
| `correo` | `text` | No | AK | — | Credencial de inicio de sesión; índice único sobre lower(correo). |
| `hash` | `text` | No | — | — | hash bcrypt de la contraseña |
| `intentos_fallidos` | `int` | No | — | `0` | Intentos de inicio de sesión fallidos. |
| `bloqueado_hasta` | `timestamptz` | Sí | — | — | Fecha y hora hasta la que la cuenta está bloqueada. |
| `estado` | `boolean` | No | — | `true` | Una cuenta inactiva no puede iniciar sesión ni renovar el token. |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de creación. |

### `roles`

**Servicio:** `auth`  
**Propósito:** catálogo de roles (RF03); semilla: ASISTENTE, ORGANIZADOR, ACCESO, ADMIN

**Clave primaria:** `id` · **Claves únicas:** `nombre` (AK_roles_1)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `nombre` | `text` | No | AK | — | Nombre del rol. |
| `descripcion` | `text` | Sí | — | — | Qué puede hacer el rol. |
| `estado` | `boolean` | No | — | `true` | Un rol inactivo no otorga permisos. |

### `usuario_roles`

**Servicio:** `auth`  
**Propósito:** resuelve la relación N:M entre usuarios y roles (RF03)

**Clave primaria:** `id` · **Claves únicas:** `usuario_id, rol_id` (AK_usuario_roles_1)

**Claves foráneas:**

- `usuario_id` → `usuarios.id` (0..*, física)
- `rol_id` → `roles.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `usuario_id` | `uuid` | No | FK, AK | — | Usuario. |
| `rol_id` | `uuid` | No | FK, AK | — | Rol asignado. |
| `asignado_en` | `timestamptz` | No | — | `now()` | Fecha de asignación. |
| `estado` | `boolean` | No | — | `true` | Asignación vigente. |

### `sesiones`

**Servicio:** `auth`  
**Propósito:** sesiones y refresco de token (RF01)

**Clave primaria:** `id`

**Claves únicas:** `hash_token` (AK_sesiones_1)

**Claves foráneas:**

- `usuario_id` → `usuarios.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `usuario_id` | `uuid` | No | FK | — | Usuario asociado. |
| `hash_token` | `text` | No | AK | — | SHA-256 del token de refresco |
| `expira_en` | `timestamptz` | No | — | — | Fecha y hora de expiración. |
| `revocada` | `boolean` | No | — | `false` | Indica si la sesión fue revocada. |

### `eventos`

**Servicio:** `catalog`  
**Propósito:** eventos del organizador y su publicación (RF04-RF06)

**Clave primaria:** `id`

**Claves foráneas:**

- `organizador_id` → `usuarios.id` (0..*, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `organizador_id` | `uuid` | No | FK | — | FK lógica a usuarios.id (auth) |
| `organizador_nombre` | `text` | No | — | — | Nombre del organizador (copia denormalizada). |
| `titulo` | `text` | No | — | — | Título del evento. |
| `descripcion` | `text` | No | — | `''` | Descripción del evento. |
| `categoria` | `text` | No | — | — | Categoría del evento. |
| `ciudad` | `text` | No | — | — | Ciudad del evento. |
| `lugar` | `text` | No | — | — | Lugar del evento. |
| `fecha` | `timestamptz` | No | — | — | Fecha y hora del evento. |
| `estado` | `text` | No | — | `'BORRADOR'` | BORRADOR \| PUBLICADO \| CANCELADO |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de creación. |

### `tipos_entrada`

**Servicio:** `catalog`  
**Propósito:** tipos de entrada con precio y cupo (RF04, RF07)

**Clave primaria:** `id`

**Claves foráneas:**

- `evento_id` → `eventos.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `evento_id` | `uuid` | No | FK | — | Evento asociado. |
| `nombre` | `text` | No | — | — | Nombre. |
| `precio` | `numeric(10,2)` | No | — | — | Precio unitario. |
| `cupo` | `int` | No | — | — | Cupo total. |
| `venta_desde` | `timestamptz` | Sí | — | — | Inicio de la ventana de venta. |
| `venta_hasta` | `timestamptz` | Sí | — | — | Fin de la ventana de venta. |

### `descuentos`

**Servicio:** `catalog`  
**Propósito:** códigos de descuento por evento (RF13)

**Clave primaria:** `id`

**Claves únicas:** `evento_id, codigo` (AK_descuentos_1)

**Claves foráneas:**

- `evento_id` → `eventos.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `evento_id` | `uuid` | No | AK, FK | — | Evento asociado. |
| `codigo` | `text` | No | AK | — | Código de descuento. |
| `porcentaje` | `int` | Sí | — | — | 1 a 100; excluyente con monto |
| `monto` | `numeric(10,2)` | Sí | — | — | descuento fijo; excluyente con porcentaje |
| `vigente_hasta` | `timestamptz` | Sí | — | — | Fecha y hora de vigencia. |
| `limite_usos` | `int` | Sí | — | — | Límite de usos del código. |
| `usos` | `int` | No | — | `0` | Usos acumulados del código. |

### `cupos`

**Servicio:** `inventory`  
**Propósito:** disponibilidad atómica por tipo de entrada (RF07-RF10, RN02)

**Clave primaria:** `tipo_entrada_id`

**Claves foráneas:**

- `tipo_entrada_id` → `tipos_entrada.id` (0..1, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `tipo_entrada_id` | `uuid` | No | PK, FK | — | Tipo de entrada original (referencia lógica a catalog.tipos_entrada). |
| `evento_id` | `uuid` | No | — | — | Evento al que pertenece el cupo (referencia lógica a catalog.eventos). |
| `nombre` | `text` | No | — | — | Nombre. |
| `cupo` | `int` | No | — | — | Cupo total. |
| `disponible` | `int` | No | — | — | se descuenta en una sola sentencia (RN02) |
| `venta_desde` | `timestamptz` | Sí | — | — | Inicio de la ventana de venta. |
| `venta_hasta` | `timestamptz` | Sí | — | — | Fin de la ventana de venta. |
| `activo` | `boolean` | No | — | `true` | Indica si el cupo está activo. |

### `reservas`

**Servicio:** `inventory`  
**Propósito:** reserva temporal de 10 minutos (RF08-RF10, RN01)

**Clave primaria:** `id`

**Claves foráneas:**

- `usuario_id` → `usuarios.id` (0..*, lógica)
- `evento_id` → `eventos.id` (0..*, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `usuario_id` | `uuid` | No | FK | — | Usuario asociado. |
| `evento_id` | `uuid` | No | FK | — | Evento asociado. |
| `estado` | `text` | No | — | `'ACTIVA'` | ACTIVA \| CONFIRMADA \| EXPIRADA \| CANCELADA |
| `expira_en` | `timestamptz` | No | — | — | Fecha y hora de expiración. |
| `orden_id` | `uuid` | Sí | — | — | Orden generada a partir de la reserva (se completa cuando orders crea la orden). |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de creación. |

### `reserva_items`

**Servicio:** `inventory`  
**Propósito:** tipos y cantidades de una reserva (RF08)

**Clave primaria:** `reserva_id, tipo_entrada_id`

**Claves foráneas:**

- `reserva_id` → `reservas.id` (0..*, física)
- `tipo_entrada_id` → `cupos.tipo_entrada_id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `reserva_id` | `uuid` | No | PK, FK | — | Reserva asociada. |
| `tipo_entrada_id` | `uuid` | No | PK, FK | — | Cupo/tipo de entrada reservado. |
| `cantidad` | `int` | No | — | — | Cantidad reservada. |

### `ordenes`

**Servicio:** `orders`  
**Propósito:** orden de compra y estado del pago (RF12, RF14, RF15)

**Clave primaria:** `id`

**Claves únicas:** `reserva_id` (AK_ordenes_1)

**Claves foráneas:**

- `reserva_id` → `reservas.id` (0..1, lógica)
- `usuario_id` → `usuarios.id` (0..*, lógica)
- `evento_id` → `eventos.id` (0..*, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador único del registro. |
| `usuario_id` | `uuid` | No | FK | — | Usuario asociado. |
| `evento_id` | `uuid` | No | FK | — | Evento asociado. |
| `reserva_id` | `uuid` | No | AK, FK | — | una orden por reserva |
| `estado` | `text` | No | — | `'PENDIENTE_PAGO'` | PENDIENTE_PAGO \| PAGADA \| PAGO_FALLIDO \| EXPIRADA \| REEMBOLSADA |
| `evento` | `jsonb` | No | — | — | copia del evento para el comprobante |
| `items` | `jsonb` | No | — | — | detalle de tipos y cantidades |
| `subtotal` | `numeric(10,2)` | No | — | — | Subtotal antes del descuento. |
| `descuento` | `numeric(10,2)` | No | — | — | Monto descontado. |
| `total` | `numeric(10,2)` | No | — | — | Total a pagar o pagado. |
| `codigo` | `text` | Sí | — | — | código de descuento aplicado |
| `nombre` | `text` | No | — | — | Nombre. |
| `correo` | `text` | No | — | — | Correo electrónico. |
| `expira_en` | `timestamptz` | No | — | — | Fecha y hora de expiración. |
| `checkout_url` | `text` | Sí | — | — | URL de la pasarela de pago. |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de creación. |
| `actualizado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de la última actualización. |

### `pagos`

**Servicio:** `orders`  
**Propósito:** pago idempotente recibido por webhook (RF14, RN06)

**Clave primaria:** `id`

**Claves foráneas:**

- `orden_id` → `ordenes.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `text` | No | PK | — | id de la pasarela; clave de idempotencia (RN06) |
| `orden_id` | `uuid` | No | FK | — | Orden asociada. |
| `estado` | `text` | No | — | — | Estado del pago en la pasarela. |
| `monto` | `numeric(10,2)` | No | — | — | Monto del pago. |
| `recibido_en` | `timestamptz` | No | — | `now()` | Fecha y hora en que se recibió el pago. |

### `reembolsos`

**Servicio:** `orders`  
**Propósito:** reembolso de una orden (RF15, RN07)

**Clave primaria:** `orden_id`

**Claves foráneas:**

- `orden_id` → `ordenes.id` (0..1, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `orden_id` | `uuid` | No | PK, FK | — | Orden asociada. |
| `monto` | `numeric(10,2)` | No | — | — | Monto del descuento o reembolso. |
| `motivo` | `text` | No | — | — | Motivo de invalidación o reembolso. |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de creación. |

### `tickets`

**Servicio:** `tickets`  
**Propósito:** ticket emitido con QR firmado; checkin conserva una réplica local (RF17, RF18, RF20, RN04)

**Clave primaria:** `id`

**Claves únicas:** `orden_id, n` (AK_tickets_1)

**Claves foráneas:**

- `orden_id` → `ordenes.id` (0..*, lógica)
- `usuario_id` → `usuarios.id` (0..*, lógica)
- `evento_id` → `eventos.id` (0..*, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | — | Identificador único del registro. |
| `orden_id` | `uuid` | No | AK, FK | — | Orden asociada. |
| `n` | `int` | No | AK | — | número de ticket dentro de la orden |
| `usuario_id` | `uuid` | No | FK | — | Usuario asociado. |
| `evento_id` | `uuid` | No | FK | — | Evento asociado. |
| `evento` | `jsonb` | No | — | — | Copia del evento para el comprobante (snapshot). |
| `tipo` | `text` | No | — | — | Tipo de entrada del ticket. |
| `titular` | `text` | No | — | — | Nombre del titular del ticket. |
| `estado` | `text` | No | — | `'VALIDO'` | VALIDO \| USADO \| INVALIDADO |
| `motivo` | `text` | Sí | — | — | Motivo de invalidación o reembolso. |
| `qr` | `text` | No | — | — | JWT firmado con Ed25519 (RN04) |
| `emitido_en` | `timestamptz` | No | — | `now()` | Fecha y hora de emisión. |

### `ingresos`

**Servicio:** `checkin`  
**Propósito:** ingreso único validado en puerta (RF21-RF23, RN05)

**Clave primaria:** `tid`

**Claves foráneas:**

- `tid` → `tickets.id` (0..1, lógica)
- `usuario_id` → `usuarios.id` (0..*, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `tid` | `uuid` | No | PK, FK | — | Ticket validado (referencia lógica a tickets.tickets). |
| `evento_id` | `uuid` | No | — | — | Evento del ticket (referencia lógica a catalog.eventos). |
| `ingreso_en` | `timestamptz` | No | — | — | Fecha y hora del ingreso. |
| `usuario_id` | `uuid` | No | FK | — | personal de acceso que escaneó |
| `dispositivo` | `text` | Sí | — | — | Dispositivo usado para el escaneo. |
| `origen` | `text` | No | — | — | en_linea \| sincronizado |

### `reportes_eventos`

**Servicio:** `reports`  
**Propósito:** proyección de evento, recaudado e ingresos (RF25, RF26)

**Clave primaria:** `evento_id`

**Claves foráneas:**

- `evento_id` → `eventos.id` (0..1, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `evento_id` | `uuid` | No | PK, FK | — | Evento original (referencia lógica a catalog.eventos). |
| `organizador_id` | `uuid` | No | — | — | Usuario organizador del evento (referencia lógica a auth.usuarios). |
| `titulo` | `text` | No | — | — | Título del evento. |
| `recaudado` | `numeric(12,2)` | No | — | `0` | Monto total recaudado. |
| `ingresos` | `int` | No | — | `0` | Cantidad de ingresos registrados. |
| `actualizado_en` | `timestamptz` | No | — | `now()` | Fecha y hora de la última actualización. |

### `reportes_ventas`

**Servicio:** `reports`  
**Propósito:** proyección de ventas por tipo de entrada (RF25)

**Clave primaria:** `tipo_entrada_id`

**Claves foráneas:**

- `evento_id` → `reportes_eventos.evento_id` (0..*, física)
- `tipo_entrada_id` → `tipos_entrada.id` (0..1, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `tipo_entrada_id` | `uuid` | No | PK, FK | — | Tipo de entrada original (referencia lógica a catalog.tipos_entrada). |
| `evento_id` | `uuid` | No | FK | — | Proyección de evento a la que pertenece la venta. |
| `nombre` | `text` | No | — | — | Nombre. |
| `precio` | `numeric(10,2)` | No | — | — | Precio unitario. |
| `cupo` | `int` | No | — | — | Cupo total. |
| `vendidas` | `int` | No | — | `0` | Cantidad de entradas vendidas. |

### `reportes_ordenes`

**Servicio:** `reports`  
**Propósito:** proyección de órdenes pagadas (RF25)

**Clave primaria:** `orden_id`

**Claves foráneas:**

- `evento_id` → `reportes_eventos.evento_id` (0..*, física)
- `orden_id` → `ordenes.id` (0..1, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `orden_id` | `uuid` | No | PK, FK | — | Orden original (referencia lógica a orders.ordenes). |
| `evento_id` | `uuid` | No | FK | — | Proyección de evento a la que pertenece la orden. |
| `entradas` | `int` | No | — | — | Cantidad de entradas de la orden. |
| `total` | `numeric(10,2)` | No | — | — | Total a pagar o pagado. |
| `estado` | `text` | No | — | — | Estado de la orden al momento de la proyección. |
| `items` | `jsonb` | No | — | — | Detalle de tipos y cantidades (snapshot). |
| `pagada_en` | `timestamptz` | No | — | — | Fecha y hora del pago. |


## Tablas agregadas en la versión 1.0 (diseño)

Se agregaron al modelo para cumplir RF02, RF28, RF30–RF35 de la especificación v1.0. Están en `ER-general.pdm` y en el PDM de su servicio, pero todavía no existen en PostgreSQL: se crean en el sprint indicado. También se agregaron dos columnas a tablas existentes:

| Tabla | Columna | Tipo | Nulo | Por defecto | Descripción | Sprint |
|---|---|---|---|---|---|---|
| `usuarios` | `estado` | `text` | No | `'PENDIENTE'` | `PENDIENTE` hasta verificar el correo, luego `ACTIVA` (RF02). | 2 |
| `ingresos` | `dispositivo_id` | `uuid` | Sí | — | Dispositivo que registró el ingreso; FK → `dispositivos.id` (RF34). | 4 |

### `verificaciones`

**Servicio:** `auth` · **Sprint:** 2  
**Propósito:** enlaces de un solo uso para verificar el correo (24 h) o recuperar la contraseña (30 min) (RF02, RN-11)

**Clave primaria:** `id` · **Claves foráneas:** `usuario_id` → `usuarios.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador. |
| `usuario_id` | `uuid` | No | FK | — | Cuenta a verificar. |
| `tipo` | `text` | No | — | — | `VERIFICACION` \| `RECUPERACION` |
| `hash_token` | `text` | No | — | — | Hash del token enviado por correo; nunca se guarda el token. |
| `expira_en` | `timestamptz` | No | — | — | Vencimiento del enlace. |
| `usado_en` | `timestamptz` | Sí | — | — | Momento de uso; un enlace usado no vuelve a servir. |

### `bitacora`

**Servicio:** `auth` · **Sprint:** 5  
**Propósito:** registro de solo lectura de acciones críticas (RF28, RNF-13)

**Clave primaria:** `id` · **Claves foráneas:** `usuario_id` → `usuarios.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador. |
| `usuario_id` | `uuid` | No | FK | — | Quién ejecutó la acción. |
| `rol` | `text` | No | — | — | Rol con el que actuó. |
| `accion` | `text` | No | — | — | `cambio_rol`, `cambio_aforo`, `reembolso`, `invalidar_ticket`, `reasignar_dispositivo`, `resolver_incidencia`… |
| `entidad` | `text` | No | — | — | Tipo de objeto afectado. |
| `entidad_id` | `uuid` | No | — | — | Objeto afectado. |
| `motivo` | `text` | No | — | — | Motivo obligatorio. |
| `detalle` | `jsonb` | Sí | — | — | Valores antes y después. |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha y hora. |

### `dispositivos`

**Servicio:** `checkin` · **Sprint:** 4  
**Propósito:** celulares autorizados para validar un evento (RF35)

**Clave primaria:** `id` · **Claves foráneas:** `usuario_id` → `usuarios.id` (0..*, lógica); `evento_id` → `eventos.id` (0..*, lógica)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador del dispositivo. |
| `evento_id` | `uuid` | No | FK | — | Evento donde valida. |
| `usuario_id` | `uuid` | No | FK | — | Personal de acceso responsable. |
| `nombre` | `text` | No | — | — | Nombre visible (Puerta norte 1). |
| `puerta` | `text` | No | — | — | Puerta o zona asignada. |
| `estado` | `text` | No | — | `'ACTIVO'` | `ACTIVO` \| `REVOCADO`; uno revocado no sincroniza. |
| `registrado_en` | `timestamptz` | No | — | `now()` | Fecha de registro. |
| `revocado_en` | `timestamptz` | Sí | — | — | Fecha de revocación. |

### `asignaciones`

**Servicio:** `checkin` · **Sprint:** 4  
**Propósito:** cada ticket asignado a un único dispositivo para validar sin conexión; la PK sobre `tid` impide asignarlo a dos (RF34, RN-06)

**Clave primaria:** `tid` · **Claves foráneas:** `tid` → `tickets.id` (0..1, lógica); `dispositivo_id` → `dispositivos.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `tid` | `uuid` | No | PK, FK | — | Ticket asignado. |
| `dispositivo_id` | `uuid` | No | FK | — | Único dispositivo que puede aceptarlo sin conexión. |
| `asignado_en` | `timestamptz` | No | — | `now()` | Fecha de asignación o reasignación. |

### `incidencias`

**Servicio:** `checkin` · **Sprint:** 4  
**Propósito:** incidencias de puerta y conflictos de sincronización con su escalamiento (RF31, RF33, RN-07, RN-12)

**Clave primaria:** `id` · **Claves foráneas:** `tid` → `tickets.id` (0..*, lógica); `dispositivo_id` → `dispositivos.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador. |
| `evento_id` | `uuid` | No | — | — | Evento. |
| `tid` | `uuid` | Sí | FK | — | Ticket involucrado, si hay. |
| `dispositivo_id` | `uuid` | Sí | FK | — | Dispositivo que la originó, si hay. |
| `tipo` | `text` | No | — | — | `PUERTA` \| `CONFLICTO_SINCRONIZACION` \| `FRAUDE` |
| `descripcion` | `text` | No | — | — | Qué pasó. |
| `reportada_por` | `uuid` | No | — | — | Usuario que la registró (o el sistema). |
| `asignada_a` | `text` | No | — | — | `ACCESO` \| `ORGANIZADOR` \| `ADMIN` según RN-12. |
| `estado` | `text` | No | — | `'ABIERTA'` | `ABIERTA` \| `ESCALADA` \| `RESUELTA` |
| `resolucion` | `text` | Sí | — | — | Decisión tomada. |
| `creada_en` | `timestamptz` | No | — | `now()` | Fecha de registro. |
| `resuelta_en` | `timestamptz` | Sí | — | — | Fecha de cierre. |

### `reclamos`

**Servicio:** `orders` · **Sprint:** 4  
**Propósito:** solicitudes de reembolso; si el organizador no responde en 5 días hábiles pasan al administrador (RF30, RF33, RN-09)

**Clave primaria:** `id` · **Claves foráneas:** `orden_id` → `ordenes.id` (0..*, física)

| Campo | Tipo | Nulo | Clave | Por defecto | Descripción |
|---|---|---|---|---|---|
| `id` | `uuid` | No | PK | `gen_random_uuid()` | Identificador. |
| `orden_id` | `uuid` | No | FK | — | Orden reclamada. |
| `usuario_id` | `uuid` | No | — | — | Asistente que reclama. |
| `motivo` | `text` | No | — | — | `CANCELACION` \| `CAMBIO_FECHA_LUGAR` \| `COBRO_ERROR` \| `NO_PUDO_ENTRAR` |
| `porcentaje` | `int` | Sí | — | — | Porcentaje a reembolsar (1-100). |
| `estado` | `text` | No | — | `'PENDIENTE'` | `PENDIENTE` \| `APROBADO` \| `RECHAZADO` \| `ESCALADO` |
| `vence_en` | `timestamptz` | No | — | — | Creación + 5 días hábiles; después escala. |
| `resuelto_por` | `uuid` | Sí | — | — | Organizador o administrador que decidió. |
| `creado_en` | `timestamptz` | No | — | `now()` | Fecha del reclamo. |
| `resuelto_en` | `timestamptz` | Sí | — | — | Fecha de la decisión. |
