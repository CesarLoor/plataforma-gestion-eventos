# Procesos BPMN – Gestión de eventos (tickets y reservas)

Modelos BPMN 2.0 de la plataforma de gestión de eventos basada en microservicios, en dos formatos:

- **`bizagi/*.bpm`**: modelos nativos de Bizagi Modeler. Se abren directamente con **Archivo → Abrir**
  o con doble clic. `bizagi/Gestion-de-eventos.bpm` reúne los 6 diagramas en un solo modelo.
- **`*.bpmn`**: BPMN 2.0 estándar (OMG), con su diagrama completo (`BPMNDiagram`). En Bizagi **no se
  abren**, se **importan** (ver más abajo). También sirven para otras herramientas BPMN.

## Procesos

| # | Archivo | Proceso | Qué modela |
|---|---------|---------|------------|
| 0 | `00-macroproceso-general.bpmn` | Macroproceso de gestión de eventos | Vista general del ciclo completo: el organizador se registra y publica el evento; el asistente se registra, compra, puede cancelar con reembolso y finalmente pasa el control de acceso. Cada etapa es un **subproceso colapsado** cuyo detalle está en los archivos 01 a 05; la pasarela de pago aparece como pool externo (caja negra). |
| 1 | `01-registro-y-autenticacion.bpmn` | Registro y autenticación | Alta de cuenta con validación de datos y verificación de correo; inicio de sesión con emisión de JWT; bloqueo temporal después de 3 intentos fallidos. |
| 2 | `02-publicar-evento.bpmn` | Publicar evento | Registro de datos, tipos de entrada y aforo; validación; preparación en paralelo (página pública, inventario de cupos, indexación); confirmación final: se publica o se guarda como borrador. |
| 3 | `03-reserva-y-compra-de-entrada.bpmn` | Reserva y compra de entrada | Verificar cupos, reserva temporal, pago contra la pasarela (flujos de mensaje), **expiración de la reserva a los 10 minutos** (temporizador de borde), **compensación** que libera el cupo si el pago se rechaza y subproceso **Emitir ticket** (QR, registro y envío). |
| 4 | `04-cancelacion-y-reembolso.bpmn` | Cancelación y reembolso | Verificación de la política de cancelación, cálculo del monto, aprobación del organizador cuando faltan menos de 48 h, anulación del ticket con liberación del cupo y reembolso a través de la pasarela. |
| 5 | `05-control-de-acceso-checkin.bpmn` | Control de acceso (check-in) | Escaneo del QR, validación del ticket, **ingreso único** (marcado atómico) y rechazo del ticket inválido o ya utilizado. |

## Actores (pools y carriles)

| Participante | Representación | Procesos |
|--------------|----------------|----------|
| Asistente | Carril del pool *Sistema de gestión de eventos* | 1 (como «Usuario»), 3, 4, 5 |
| Organizador | Carril del pool *Sistema de gestión de eventos* | 1 (como «Usuario»), 2, 4 |
| Plataforma (sistema) | Carril del pool *Sistema de gestión de eventos* (tareas de servicio) | 1–5 |
| Personal de acceso | Carril del pool *Sistema de gestión de eventos* | 5 |
| Pasarela de pago (externa) | **Pool independiente**, comunicado con flujos de mensaje | 0 (caja negra), 3, 4 |

La documentación de cada tarea de servicio indica qué microservicio la ejecuta: `ms-usuarios`,
`ms-autenticacion`, `ms-eventos`, `ms-catalogo`, `ms-reservas`, `ms-pagos`, `ms-tickets`,
`ms-notificaciones` y `ms-acceso`. En Bizagi aparece en la descripción del elemento.

## Elementos utilizados

- Tareas de usuario, de servicio y manuales.
- Gateways exclusivos (todas las salidas llevan su condición rotulada) y paralelos.
- Eventos de inicio, de fin, intermedios de mensaje y de compensación, temporizador de borde
  (`PT10M`) y evento de borde de compensación.
- Subproceso expandido (*Emitir ticket*), subprocesos colapsados (macroproceso), anotaciones y asociaciones.
- Flujos de mensaje entre el pool del sistema y el de la pasarela de pago.

Cada proceso tiene un único evento de inicio. En los archivos 03 y 04, la pasarela es un proceso
aparte, con su propio inicio de mensaje. El subproceso *Emitir ticket* tiene su inicio interno.

## Cómo abrir en Bizagi Modeler

**Opción A: abrir el modelo nativo (recomendada).** En Bizagi: **Archivo → Abrir** y selecciona
`bizagi/Gestion-de-eventos.bpm`. Se abren los 6 diagramas en pestañas, con el macroproceso primero.
Si sólo te interesa un proceso, abre el `.bpm` correspondiente.

> Bizagi no abre archivos `.bpmn` con *Abrir*: el diálogo sólo admite `.bpm`. Los `.bpmn` hay que
> importarlos (opción B).

**Opción B: importar los `.bpmn`.**

1. Abre Bizagi Modeler y crea un modelo nuevo, o abre uno existente (por ejemplo, `Nuevo Modelo.bpm`).
2. Ve a **Archivo → Importar → BPMN** (en algunas versiones: *Importar BPMN 2.0*).
3. Selecciona uno de los archivos `.bpmn` de esta carpeta y confirma. El proceso se agrega como un
   diagrama nuevo del modelo.
4. Repite con los demás archivos (Bizagi importa un archivo a la vez).
5. Guarda el modelo (`.bpm`).

Si Bizagi muestra el diagrama recortado, usa *Ajustar a la ventana* o el zoom: los diagramas son
anchos porque el flujo avanza de izquierda a derecha.

## Validación realizada

Para cada archivo `.bpmn` se comprobó lo siguiente:

1. **XML bien formado** (`xmllint --noout`) y **válido contra el esquema oficial OMG BPMN 2.0**
   (`BPMN20.xsd`, `xmllint --schema`).
2. **Cobertura del DI:** cada flowNode, anotación, pool y carril tiene su `BPMNShape` con `dc:Bounds`,
   y cada sequenceFlow, flujo de mensaje y asociación tiene su `BPMNEdge` con `di:waypoint`.
3. **Reglas de modelado:** IDs únicos, sin elementos ni atributos fuera de los namespaces estándar, un
   inicio y al menos un fin por proceso, `incoming`/`outgoing` consistentes y gateways con todas sus
   salidas rotuladas.
4. **Geometría:** sin figuras superpuestas, al menos 40 px de separación entre figuras, ninguna línea
   que atraviese una figura, conectores ortogonales, ningún cruce entre líneas y rótulos sin
   superponerse.
5. **Importación con el motor de Bizagi Modeler** instalado (`BPMN20InteropManager.Import`, ejecutado
   sin interfaz gráfica): los 6 archivos se importan sin errores, y los 290 elementos gráficos
   coinciden con el XML en nombre, posición, tamaño y waypoints.
6. **Modelos `.bpm`:** generados con el mismo motor de Bizagi (importar y guardar) y vueltos a cargar
   con él: cada modelo abre sus diagramas con todos sus elementos.
