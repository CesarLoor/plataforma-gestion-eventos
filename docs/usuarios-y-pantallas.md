# Usuarios y pantallas del prototipo

Funciona en celular y en computadora, y se puede instalar como app (PWA). Hay dos formas de probarla:

| Entorno | Dirección | Cuándo usarlo |
|---|---|---|
| Local | **https://localhost** | Siempre disponible: se levanta en tu equipo con Docker (ver README, *Levantar en local*). Solo desde ese equipo |
| Servidor | **https://34-230-232-119.sslip.io** | Demo pública y pruebas desde el celular. Solo responde si la instancia EC2 está encendida (`docs/operacion.md`, sección 4) |

## 1. Usuarios de prueba

Todos comparten la contraseña `SEED_PASSWORD` del `.env` del entorno que uses: en local, el `.env` de tu equipo (`grep SEED_PASSWORD .env`); en el servidor, el suyo (`docs/operacion.md`, sección 2).

| Rol | Correo | Al iniciar sesión entra a |
|---|---|---|
| Asistente | `asistente@eventos.ec` | Catálogo |
| Asistente 2 | `asistente2@eventos.ec` | Catálogo |
| Organizador | `organizador@eventos.ec` | Panel |
| Personal de acceso | `acceso@eventos.ec` | Control de acceso |
| Administración | `admin@eventos.ec` | Administración |

Cualquiera puede **crear una cuenta** de asistente u organizador con **Entrar → Crear cuenta**. Los roles de acceso y administración no se pueden elegir al registrarse, para que nadie se dé esos permisos a sí mismo; solo un administrador los asigna.

## 2. Qué puede hacer cada rol

### Asistente
Compra entradas y las usa para entrar al evento.

| Puede | Requisitos |
|---|---|
| Buscar eventos por nombre, ciudad o lugar y filtrar por categoría | RF06 · CU02 |
| Ver los cupos disponibles al momento | RF07 · CU04 |
| Elegir entradas de varios tipos y aplicar un código de descuento (`ESPE10`) | RF05, RF13 · CU03, CU05 |
| Reservar: los cupos quedan apartados 10 minutos mientras paga | RF08-RF10 · CU03 |
| Pagar en la pasarela (simulada) y recibir el comprobante por correo | RF12, RF14, RF16 · CU06 |
| Ver sus tickets con QR firmado, también sin conexión, y descargarlos | RF17, RF18 · CU07, CU08 |

**No puede:** ver órdenes, reservas ni tickets de otra persona (responde "no encontrado"), validar tickets ni ver paneles de ventas.

### Organizador
Publica sus eventos y sigue las ventas.

| Puede | Requisitos |
|---|---|
| Crear un evento con fecha, lugar, categoría y hasta 5 tipos de entrada (precio y cupo) | RF04, RF05 · CU10, CU11 |
| Guardarlo como borrador o publicarlo en el catálogo | RF04 · CU10 |
| Ver en vivo las entradas vendidas, lo recaudado, el % de aforo, los ingresos y las ventas por tipo | RF25 · CU13 |
| Exportar las ventas a CSV, sin datos personales de los compradores | RF26 · CU14 |
| Cancelar un evento: se anulan todos sus tickets y se reembolsan las compras | RF15, RF20 · CU15, CU16 |
| Crear códigos de descuento (por la API) | RF13 · CU12 |

**No puede:** ver ni modificar eventos o paneles de otros organizadores, ni comprar entradas con esa cuenta.

### Personal de acceso
Controla el ingreso en la puerta.

| Puede | Requisitos |
|---|---|
| Elegir el evento y escanear el QR con la cámara, o pegar el código | RF21 · CU20 |
| Ver el resultado en grande: **verde** = ingreso permitido, **ámbar** = ya fue usado (con la hora del primer ingreso), **rojo** = inválido | RF21, RF22 · CU21, CU22 |
| Guardar la lista del evento en el teléfono y validar **sin internet** | RF23 · CU23 |
| Sincronizar los ingresos pendientes al volver la conexión y ver los duplicados | RF23 · CU24 |
| Ver el contador de ingresos | RF25 · CU25 |

**No puede:** comprar, ver ventas ni modificar eventos.

### Administración
Supervisa la plataforma.

| Puede | Requisitos |
|---|---|
| Todo lo del organizador sobre cualquier evento (panel, publicar, cancelar) | RF04, RF25 · CU13 |
| Usar el control de acceso | RF21 · CU20 |
| Buscar cuentas y cambiar su rol desde la pantalla **Administración**, con motivo obligatorio; nadie puede cambiar su propio rol y el cambio queda en la bitácora | RF03, RF28 · CU18, CU19 |
| Ver todos los eventos y abrirlos en el panel | RF27 · CU17 |

Pendiente para el sprint 4: pestañas Dispositivos (RF34, RF35), Incidencias (RF31–RF33) y Bitácora (RF28). Hoy las acciones críticas quedan en los logs del servidor.

## 3. Pantallas

En el celular la navegación está abajo; en la computadora, arriba, junto a la marca **Aforo**.

| # | Pantalla | Quién | Qué se ve y qué se hace |
|---|---|---|---|
| 0 | **Iniciar sesión / Crear cuenta** | Todos | Correo y contraseña. Tras 3 intentos fallidos la cuenta se bloquea 15 minutos; el mensaje dice cuántos intentos quedan. En computadora, a la izquierda, un panel presenta la plataforma |
| 1 | **Catálogo** | Todos | Buscador, filtros por categoría y tarjetas de los eventos con fecha, lugar, precio y cupos. Etiqueta ámbar "Últimos N cupos" cuando quedan pocos; los agotados se ven en gris y no se pueden comprar |
| 2 | **Detalle y entradas** | Asistente | Descripción, tipos de entrada con selector de cantidad (no deja pedir más de lo disponible), código de descuento, total en vivo y el botón **Reservar y pagar**. Si los cupos se agotan mientras eliges, avisa y actualiza los números |
| 3 | **Reserva y pago** | Asistente | Cuenta regresiva de 10 minutos, resumen, datos del comprador y aceptación de la política de datos (LOPDP). **Ir a pagar** abre la pasarela, donde se escribe la tarjeta |
| — | **Pasarela de pagos** (simulada) | Asistente | Página aparte, la del actor externo, donde se escribe la tarjeta de prueba. Al pagar vuelve sola a la app |
| — | **Resultado del pago** | Asistente | Espera la confirmación: aprobado (con el botón **Ver mis tickets**), rechazado (con **Intentar de nuevo**), vencido o reembolsado |
| 4 | **Mis tickets** | Asistente | Un ticket por entrada con QR grande, estado (válido, usado o anulado), titular y número. Botón **Descargar**; **Transferir** aparece como "próximamente". Funciona en modo avión |
| 5 | **Panel del organizador** | Organizador, admin | Selector de evento, vendidas sobre aforo, recaudado, % de aforo, ingresos, barras por tipo de entrada. Botones **Exportar CSV** y **Cancelar evento**. Se actualiza solo cada 10 segundos |
| 5b | **Nuevo evento** | Organizador | Formulario del evento y sus tipos de entrada. **Guardar borrador** o **Publicar** |
| 6 | **Control de acceso** | Acceso, admin | Indicador En línea o Sin conexión, cámara, resultado grande en color, campo para pegar el código, contadores de ingresos y pendientes, botones **Guardar lista** y **Sincronizar**, y la casilla **Simular sin conexión** para la demo |
| 7 | **Administración** | Admin | Pestaña Usuarios y roles: buscador, cada cuenta con su rol o "Bloqueada", selector de rol y motivo. Pestaña Eventos: todos los eventos con su estado y acceso al panel |
| — | **Cuenta** | Con sesión | Nombre, correo y rol. **Cerrar sesión** también invalida la sesión en el servidor |

### Tarjetas de prueba (pasarela simulada)

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | Aprueba |
| `4000 0000 0000 0002` | Rechaza: se puede reintentar mientras la reserva siga vigente |
| `4000 0000 0000 9995` | Aprueba sin aviso: la plataforma consulta el estado sola en unos segundos |
| `4000 0000 0000 0259` | Aprueba y envía el aviso dos veces: igual salen los tickets justos |

## 4. Guion de demostración (unos 7 minutos dentro de los 15)

1. **Asistente:** entra con `asistente@eventos.ec`. En el catálogo, "Noche de Jazz" muestra "Últimos cupos" y "Festival Malecón" aparece agotado.
2. Abre "Noche de Jazz", elige 2 entradas General, aplica `ESPE10` y pulsa **Reservar y pagar**. Muestra la cuenta regresiva.
3. Paga con `4000 0000 0000 0259`, el aviso doble, y explica que no se duplican los tickets. Abre **Mis tickets** con los 2 QR.
4. **Organizador:** en otra ventana, `organizador@eventos.ec`. El panel ya muestra las 2 ventas.
5. **Personal de acceso:** en el celular, `acceso@eventos.ec`, **Guardar lista** y marca **Simular sin conexión**. Escanea el QR de la pantalla: sale **verde**. Escanéalo de nuevo: sale **ámbar**, "Ya fue usado".
6. Desmarca la casilla y pulsa **Sincronizar**. En el panel del organizador sube "Ya ingresaron".
7. Cierra con la seguridad: el QR va firmado (si se altera, sale rojo), la tarjeta nunca toca la plataforma, nadie ve datos ajenos, la cuenta se bloquea tras 3 intentos y la prueba de 200 personas sobre 50 cupos termina con exactamente 50 reservas.
