# Base de conocimiento: plataforma de gestión de eventos con microservicios

> Archivo consolidado del proyecto para usar como contexto en Claude Code.
> Reúne el Taller 1, el Entregable 1 y la Propuesta del SI. La última sección trae el prompt para construir el primer prototipo.
> Copiar este archivo en la raíz del repositorio como `docs/base-conocimiento.md` y referenciarlo desde `CLAUDE.md`.

---

## 0. Ficha del proyecto

| Campo | Valor |
|---|---|
| Asignatura | Construcción y evolución del software (NRC 36847), ESPE, Departamento de Ciencias de la Computación, Carrera de Ingeniería de Software |
| Tutora | Mayra Isabel Alvarez Jimenez |
| Equipo | Cesar Ignacio Loor Mercado, Kevin David Asmal Haro |
| Producto | Plataforma web (PWA) para publicar eventos locales, reservar y vender entradas sin sobreventa, emitir tickets con QR firmado y controlar el ingreso, incluso sin conexión |
| Arquitectura | Microservicios independientes, cada uno con su base de datos, coordinados por eventos (patrón Saga en la compra) |
| Infraestructura | Contenedores Docker en **un solo servidor virtual EC2 de AWS**, sin servicios gestionados. AWS se usa solo como servidor |
| Práctica | DevOps / DevSecOps: CI/CD, escaneo de dependencias e imágenes, observabilidad |
| Duración | 10 semanas, 5 sprints de 2 semanas, del 26 oct 2026 al 3 ene 2027 |
| Idioma | Interfaz, documentación y mensajes en español |

---

## 1. Problemática

La venta de entradas y la gestión de reservas en eventos locales (conciertos, ferias, actividades universitarias, obras de teatro, cenas de gala) se hace de forma informal y fragmentada: transferencias confirmadas por mensajes, hojas de cálculo compartidas, formularios sueltos y entradas en papel o imágenes fáciles de copiar. No existe una única fuente confiable que diga cuántos cupos quedan, quién pagó y quién ya ingresó.

Problemas que se repiten:

1. **Sobreventa y dobles reservas.** Sin inventario único y al momento, varias personas compran el mismo cupo; el organizador lo descubre en la puerta.
2. **Fraude y falsificación.** Un QR o imagen estática se copia y reenvía; no hay forma de saber si una entrada ya fue usada.
3. **Control de acceso lento y sin respaldo.** La validación manual forma filas; con mala conexión los sistemas en línea fallan justo cuando más se necesitan.
4. **Conciliación de pagos manual.** Comprobantes revisados uno a uno, errores, reclamos; reembolsos lentos y sin trazabilidad.
5. **Falta de visibilidad.** El organizador no sabe cuánto vendió ni cuántos ingresaron hasta que el evento pasó.
6. **Plataformas existentes poco adecuadas.** Comisiones altas, poco adaptadas a pagos y procesos locales, y monolíticas: si falla el pago en un pico, cae todo.

Los picos de demanda (preventas, lanzamientos) concentran muchas solicitudes en minutos y agravan todo lo anterior.

### A quién afecta

| Afectado | Cómo le afecta |
|---|---|
| Asistentes | Pagan sin garantía de que su entrada sea válida, pierden dinero por fraude o cancelación, hacen filas largas |
| Organizadores pequeños y medianos | Pierden ingresos por entradas falsas, sobreventa y devoluciones; horas conciliando pagos; deciden sin datos |
| Personal de acceso | Valida sin herramientas confiables y asume los conflictos con el público |
| Recintos y patrocinadores | Riesgo de exceder el aforo y daño de imagen |

### Por qué debe resolverse

Pérdidas económicas directas, pérdida de confianza del público, riesgo para las personas por aforo mal controlado, datos personales circulando sin control y freno al crecimiento de organizadores pequeños.

### Necesidad y oportunidad

- **Necesidad:** un medio único y confiable, usable desde el celular, para publicar eventos, reservar y vender sin sobreventa, cobrar en línea, emitir tickets verificables y controlar el ingreso aunque no haya internet, que aguante picos de demanda y dé al organizador información al momento.
- **Oportunidad:** organizadores pequeños y medianos no tienen una herramienta a su medida. Técnicamente, la propuesta combina microservicios (escalar solo lo saturado, aislar fallos), PWA (una sola base de código, instalable, uso sin conexión) y DevOps con infraestructura mínima (costo bajo, entrega automatizada y segura).
- **Beneficiarios directos:** asistentes (seguridad y comodidad), organizadores (control, ingresos, datos), personal de acceso (ingreso ágil y sin conflictos).

---

## 2. Objetivos

**Objetivo general.** Diseñar y construir un sistema de información que permita publicar eventos locales, reservar y vender entradas sin sobreventa, emitir tickets que se puedan verificar y controlar el ingreso en la puerta, con servicios independientes desplegados en un servidor virtual de AWS.

| ID | Objetivo específico | Problema que atiende | Meta verificable |
|---|---|---|---|
| OE1 | Evitar que un mismo cupo se venda dos veces | Sobreventa y dobles reservas | Cero sobreventas en pruebas de concurrencia con 200 usuarios reservando a la vez |
| OE2 | Emitir tickets que no se puedan falsificar ni reutilizar | Fraude | Se rechazan todos los tickets falsos o repetidos de la prueba de aceptación |
| OE3 | Ingreso rápido que siga funcionando sin internet | Filas y validación manual | Validación en menos de 5 s por ticket, también en modo avión |
| OE4 | Cobrar en línea y dejar respaldo de cada pago | Conciliación manual, reembolsos lentos | Toda compra con comprobante y estado visible; reembolsos registrados |
| OE5 | Mostrar al organizador ventas, ingresos y ocupación al momento | Decisiones sin datos | Panel actualizado en menos de 1 minuto tras cada venta o ingreso |
| OE6 | Construir y publicar de forma repetible y segura | Caídas totales, despliegues manuales | Despliegue automático desde el pipeline; cero vulnerabilidades críticas abiertas al cierre |

---

## 3. Alcance y novedad

### 3.1 Alcance de la primera versión (MVP)

| Área | Incluye | Queda para una segunda etapa |
|---|---|---|
| Usuarios y roles | Registro, inicio de sesión, verificación de correo, 4 roles: asistente, organizador, personal de acceso, administrador | Inicio de sesión con redes sociales |
| Eventos | Publicar, editar, cancelar; tipos de entrada con precio y cupo; búsqueda por categoría, fecha, ciudad y precio | Asientos numerados con mapa del recinto |
| Reservas | Disponibilidad al momento, reserva temporal de 10 min con liberación automática, control de sobreventa | Lista de espera (RF11) |
| Órdenes y pagos | Orden con varias entradas, códigos de descuento, pago en línea en **modo de pruebas**, comprobante por correo, reembolsos | Cobros reales, facturación electrónica, transferencia con revisión manual (en el prototipo solo aparece como opción futura) |
| Tickets | QR firmado de un solo uso, descarga y uso sin conexión, invalidación, transferencia (prioridad baja) | Reventa entre usuarios |
| Acceso | Escaneo desde el celular, resultado (válido / usado / inválido), registro del ingreso, modo sin conexión con sincronización | Lectores dedicados |
| Avisos y reportes | Correos de confirmación, recordatorio y cambios; panel del organizador; exportación | Push, recomendaciones, analítica avanzada |
| Administración | Moderación de eventos y organizadores, gestión de roles, bitácora de acciones críticas | Métricas globales de la plataforma |

### 3.2 Novedad (planteada como propuesta, no como dato de mercado)

| Aspecto | Cómo se hace hoy | Qué propone el sistema |
|---|---|---|
| Cupos | Registro manual o por mensajes; la sobreventa se descubre en la puerta | Inventario único con reserva temporal y liberación automática |
| Entrada | Papel o imagen fácil de copiar | QR firmado de un solo uso, con estado visible |
| Ingreso | Revisión manual, filas, dependencia de internet | Validación desde el celular que funciona sin conexión y sincroniza después |
| Pago | Transferencias confirmadas por mensaje | Pago en línea con comprobante y reembolsos registrados |
| Información | El organizador sabe cuánto vendió al final | Panel con ventas, ingresos y ocupación al momento |
| Arquitectura | Un solo bloque: si falla el pago, cae todo | Servicios independientes en un solo servidor de bajo costo |

Pendiente del sprint 1: comparar con plataformas concretas (comisiones, funciones) para respaldar la novedad con evidencia.

---

## 4. Ciclo de vida (SDLC) aplicado

El ciclo se repite por incrementos sobre el MVP; tras Mantenimiento, la retroalimentación reabre Requisitos.

| Fase | Objetivo | Aplicación en el proyecto | Artefactos |
|---|---|---|---|
| 1. Necesidad | Identificar qué resolver y si vale la pena | Problema de venta informal, sobreventa y fraude; revisar plataformas; objetivo, alcance, riesgos | Visión y alcance, árbol de problemas, análisis de plataformas, matriz de riesgos |
| 2. Requisitos | Entender qué espera cada usuario | Entrevistas/encuestas, historias de usuario, RF y RNF, priorización | Documento de requisitos, historias priorizadas, matriz de trazabilidad |
| 3. Análisis | Modelar la solución | Actores, casos de uso, reglas de negocio, bounded contexts | Casos de uso, modelo conceptual de datos, reglas de negocio, mapa de contextos |
| 4. Diseño | Definir cómo se construye | Arquitectura de microservicios y API Gateway, BD por servicio, OpenAPI, eventos y Saga, seguridad, prototipo, infraestructura | Diagrama de arquitectura, modelo lógico de datos, OpenAPI, secuencias, BPMN, prototipo, ADR |
| 5. Construcción | Implementar incrementalmente | Un servicio por contexto, PWA con Service Worker, broker de mensajes, ramas y revisión de código | Repositorio, imágenes Docker, PWA funcional, documentación por servicio |
| 6. Pruebas | Verificar requisitos y seguridad | Unitarias, integración, contrato, carga/concurrencia, OWASP, modo sin conexión, aceptación | Plan y casos de prueba, cobertura, informes de carga y seguridad, acta de aceptación |
| 7. Despliegue | Producción repetible y segura | CI/CD, Docker Compose en EC2, proxy inverso con HTTPS, secretos, IaC | Pipeline, IaC, guía de despliegue, plan de reversión |
| 8. Operación | Disponible y observable | Métricas, logs, trazas, alertas, respaldos, control de costos, incidentes | Paneles, runbooks, política de respaldos |
| 9. Mantenimiento | Corregir y evolucionar | Parches, dependencias, nuevas funciones (reventa, recomendaciones, facturación) | Changelog, versiones etiquetadas, backlog, informe de deuda técnica |

---

## 5. Metodología

**Scrum adaptado a dos personas + CI/CD.** De Kanban se usa el tablero; de XP, pruebas automáticas e integración continua. Cascada descartada (cambios tardíos caros en concurrencia y pagos).

| Reunión | Cuándo | Qué se hace |
|---|---|---|
| Planificación | Primer día del sprint | Historias que caben en 2 semanas y objetivo del sprint |
| Seguimiento breve | 3 veces por semana | Qué hice, qué sigue, qué me traba |
| Refinamiento | Mitad del sprint | Ajustar prioridad y tamaño |
| Revisión | Último día | Mostrar el incremento a la tutora y usuarios de prueba |
| Retrospectiva | Tras la revisión | Revisar indicadores, máximo 2 acciones con responsable |

**Definición de terminado:** el otro integrante revisó el código, las pruebas automáticas pasan, el escáner de seguridad no reporta críticas, la API está documentada y el cambio está desplegado en el entorno de pruebas.

### Roles

| Rol | Quién | Responsabilidad |
|---|---|---|
| Product Owner y analista | Kevin Asmal | Backlog, historias de usuario, validar alcance con la tutora |
| Líder técnico y DevOps | Cesar Loor | Arquitectura, pipeline, servidor, revisión de seguridad |
| Desarrollo de servicios | Cesar (lidera) y Kevin | Usuarios, catálogo, inventario, órdenes, tickets, acceso |
| PWA y pruebas de aceptación | Kevin (lidera) y Cesar | Interfaz, prototipo, pruebas con usuarios |
| Facilitador del sprint | Rotativo | Reuniones, tiempos, acciones de mejora |
| Tutora | Mayra Isabel Alvarez Jimenez | Revisa avances y orienta |

### Matriz RACI

| Actividad | Cesar | Kevin | Tutora | Usuarios de prueba |
|---|---|---|---|---|
| Visión, alcance y plan | R | A/R | C | - |
| Requisitos e historias | R | A/R | C | C |
| Casos de uso y modelo conceptual | R | A/R | C | - |
| Procesos BPMN | A/R | R | I | - |
| Arquitectura, API, decisiones técnicas | A/R | C | I | - |
| Prototipo e interfaz | C | A/R | C | C |
| Desarrollo de servicios | A/R | R | I | - |
| Desarrollo de la PWA | C | A/R | I | I |
| Pruebas funcionales y de aceptación | R | A/R | I | C |
| Pruebas de seguridad y carga | A/R | C | I | - |
| Pipeline, despliegue y monitoreo | A/R | C | I | - |
| Política y revisiones de seguridad | A/R | R | I | - |
| Indicadores y retrospectivas | R | A/R | I | - |
| Informe y presentación final | R | A/R | C | I |

### Sprints

| Sprint | Fechas | Objetivo y entrega |
|---|---|---|
| 1 | 26 oct al 8 nov | Requisitos, historias, casos de uso, modelo conceptual, BPMN |
| 2 | 9 al 22 nov | Arquitectura, contratos de API, prototipo, repositorio con pipeline inicial, servicio de usuarios |
| 3 | 23 nov al 6 dic | Catálogo, inventario con reserva temporal y liberación automática, pruebas de concurrencia |
| 4 | 7 al 20 dic | Órdenes, pago en modo de pruebas, tickets con QR, control de ingreso sin conexión |
| 5 | 21 dic al 3 ene | Notificaciones, panel del organizador, pruebas de carga y seguridad, despliegue, informe final |

---

## 6. Requisitos

### 6.1 Actores

| Actor | Qué necesita | Casos de uso |
|---|---|---|
| Asistente | Encontrar eventos, ver disponibilidad real, reservar y pagar con seguridad, tener su ticket aunque no haya internet | CU02 a CU09 |
| Organizador | Publicar eventos sin ayuda técnica, definir entradas y precios, ver ventas, manejar cancelaciones y reembolsos | CU10 a CU16 |
| Personal de acceso | Validar rápido, detectar duplicados y falsos, trabajar con mala conexión | CU20 a CU25 |
| Administrador | Moderar, gestionar roles, revisar acciones críticas | CU17 a CU19 |
| Pasarela de pago (externo) | Recibir la orden, cobrar y notificar | CU06 |
| Todos | Registrarse e iniciar sesión | CU01 |

### 6.2 Requisitos funcionales

| ID | Módulo | Requisito | Actor | Prioridad |
|---|---|---|---|---|
| RF01 | Usuarios | Registrarse e iniciar sesión con correo y contraseña | Todos | Alta |
| RF02 | Usuarios | Verificar el correo y recuperar la contraseña | Todos | Media |
| RF03 | Usuarios | Asignar y cambiar roles | Administrador | Alta |
| RF04 | Eventos | Crear, editar, publicar y cancelar eventos con fecha, lugar, descripción e imagen | Organizador | Alta |
| RF05 | Eventos | Definir tipos de entrada con precio, cupo y fechas de venta | Organizador | Alta |
| RF06 | Eventos | Buscar y filtrar por categoría, fecha, ciudad y precio | Asistente | Media |
| RF07 | Reservas | Consultar la disponibilidad de cupos al momento | Asistente | Alta |
| RF08 | Reservas | Reservar cupos de forma temporal (10 min) mientras se paga | Asistente | Alta |
| RF09 | Reservas | Liberar automáticamente las reservas vencidas | Sistema | Alta |
| RF10 | Reservas | Impedir vender más cupos de los disponibles aunque haya compras simultáneas | Sistema | Alta |
| RF11 | Reservas | Lista de espera cuando el cupo se agota | Asistente | Baja |
| RF12 | Órdenes y pagos | Armar una orden con una o varias entradas | Asistente | Alta |
| RF13 | Órdenes y pagos | Aplicar códigos de descuento del organizador | Asistente | Media |
| RF14 | Órdenes y pagos | Pagar en línea mediante pasarela (modo de pruebas) | Asistente | Alta |
| RF15 | Órdenes y pagos | Reembolsar total o parcialmente si se cancela un evento | Organizador | Media |
| RF16 | Órdenes y pagos | Enviar comprobante de compra por correo | Asistente | Media |
| RF17 | Tickets | Emitir ticket con QR único y firmado al confirmar el pago | Sistema | Alta |
| RF18 | Tickets | Ver y descargar el ticket, también sin conexión | Asistente | Alta |
| RF19 | Tickets | Transferir un ticket a otra persona | Asistente | Baja |
| RF20 | Tickets | Invalidar un ticket por reembolso, cancelación o fraude | Organizador | Media |
| RF21 | Acceso | Escanear el QR y mostrar válido / ya usado / inválido | Personal de acceso | Alta |
| RF22 | Acceso | Registrar fecha y hora del ingreso y bloquear un segundo uso | Personal de acceso | Alta |
| RF23 | Acceso | Validar sin conexión y sincronizar después | Personal de acceso | Media |
| RF24 | Avisos | Confirmación, recordatorio y aviso de cambios o cancelación | Asistente | Media |
| RF25 | Reportes | Panel con ventas, ingresos y asistencia casi en tiempo real | Organizador | Alta |
| RF26 | Reportes | Exportar reportes en CSV o PDF | Organizador | Baja |
| RF27 | Administración | Moderar eventos y organizadores | Administrador | Media |
| RF28 | Administración | Bitácora de acciones críticas (compras, reembolsos, cambios de rol) | Administrador | Media |

### 6.3 Requisitos no funcionales

| ID | Categoría | Requisito | Cómo se mide |
|---|---|---|---|
| RNF01 | Rendimiento | Consultas y reservas rápidas con varios usuarios | p95 < 500 ms con 200 usuarios simultáneos |
| RNF02 | Picos de demanda | Aguantar la apertura de una venta | < 1 % de errores 5xx con 200 usuarios reservando a la vez |
| RNF03 | Consistencia | Nunca vender más de lo disponible | Cero sobreventas en pruebas de concurrencia |
| RNF04 | Disponibilidad | La compra sigue aunque falle un servicio secundario (avisos) | 99 % del flujo de compra en pruebas con usuarios |
| RNF05 | Seguridad de acceso | Sesiones con vencimiento, roles, bloqueo tras intentos fallidos | OWASP Top 10 sin hallazgos críticos |
| RNF06 | Protección de datos | Cifrado en tránsito, sin datos de tarjeta, acorde a la LOPDP | 100 % HTTPS; revisión de datos almacenados |
| RNF07 | Integridad de tickets | QR firmado, un solo uso | Se rechazan todos los falsos o repetidos |
| RNF08 | Usabilidad | Español, adaptable al celular, instalable como PWA | Compra < 3 min; SUS ≥ 68 |
| RNF09 | Sin conexión | Ticket visible y validación sin internet | Prueba en modo avión + sincronización posterior |
| RNF10 | Accesibilidad | Contraste, tamaños, navegación | WCAG 2.1 AA en pantallas principales |
| RNF11 | Observabilidad | Logs, métricas y alertas por servicio | Panel de latencia, errores y uso; alerta si un servicio cae |
| RNF12 | Mantenibilidad | Servicios independientes, BD propia, API documentada | Cobertura ≥ 70 % por servicio |
| RNF13 | Despliegue | Contenedores y despliegue automatizado en un servidor | Despliegue completo < 15 min |
| RNF14 | Resiliencia | Un reintento no duplica cobros ni notificaciones | Pruebas con mensajes y pagos repetidos sin compras dobles |

### 6.4 Trazabilidad necesidad → requisito → artefacto

| Necesidad | Requisitos | Artefacto que la demuestra |
|---|---|---|
| Que no se venda el mismo cupo dos veces | RF07 a RF10, RNF03 | Servicio de inventario + informe de prueba de concurrencia |
| Que la entrada no se pueda copiar | RF17, RF20, RF22, RNF07 | Servicio de tickets (QR firmado) + casos de prueba de fraude |
| Entrar rápido aunque no haya internet | RF21 a RF23, RNF09 | Pantalla de acceso PWA + prueba en modo avión |
| Pagar con respaldo y recibir comprobante | RF12 a RF16, RNF14 | Saga de compra, servicio de órdenes, correo de comprobante |
| Saber cuánto se vendió al momento | RF25, RF26 | Panel del organizador |
| Que el sistema no caiga en una preventa | RNF01, RNF02, RNF04 | Informe de prueba de carga + arquitectura de servicios |
| Proteger datos personales | RF28, RNF05, RNF06 | Política de seguridad, revisión OWASP, bitácora |

---

## 7. Casos de uso

Tres diagramas UML (asistente + pasarela; organizador + administrador; personal de acceso). CU01 lo usan todos.

| ID | Caso de uso | Actor | Relación | Requisitos |
|---|---|---|---|---|
| CU01 | Registrarse e iniciar sesión | Todos | Principal | RF01, RF02 |
| CU02 | Buscar y filtrar eventos | Asistente | Principal | RF06 |
| CU03 | Reservar entradas | Asistente | Principal | RF08, RF09, RF10 |
| CU04 | Consultar disponibilidad | Sistema | «include» de CU03 | RF07 |
| CU05 | Aplicar código de descuento | Asistente | «extend» de CU03 | RF13 |
| CU06 | Pagar la orden | Asistente, pasarela | Principal | RF12, RF14, RF16, RF24 |
| CU07 | Emitir ticket con código QR | Sistema | «include» de CU06 | RF17 |
| CU08 | Ver y descargar ticket | Asistente | Principal | RF18 |
| CU09 | Transferir ticket | Asistente | «extend» de CU08 | RF19 |
| CU10 | Publicar y editar eventos | Organizador | Principal | RF04 |
| CU11 | Definir tipos de entrada y precios | Organizador | Principal | RF05 |
| CU12 | Crear códigos de descuento | Organizador | Principal | RF13 |
| CU13 | Consultar panel de ventas | Organizador | Principal | RF25 |
| CU14 | Exportar reporte | Organizador | «extend» de CU13 | RF26 |
| CU15 | Cancelar evento y reembolsar | Organizador | Principal | RF15, RF24 |
| CU16 | Invalidar tickets | Sistema | «include» de CU15 | RF20 |
| CU17 | Moderar eventos y organizadores | Administrador | Principal | RF27 |
| CU18 | Gestionar roles | Administrador | Principal | RF03 |
| CU19 | Consultar bitácora de acciones | Administrador | Principal | RF28 |
| CU20 | Escanear y validar ticket | Personal de acceso | Principal | RF21 |
| CU21 | Verificar firma y estado del ticket | Sistema | «include» de CU20 | RF21 |
| CU22 | Registrar fecha y hora del ingreso | Sistema | «include» de CU20 | RF22 |
| CU23 | Validar sin conexión | Personal de acceso | «extend» de CU20 | RF23 |
| CU24 | Sincronizar registros pendientes | Personal de acceso | Principal | RF23 |
| CU25 | Consultar resumen de ingresos | Personal de acceso | Principal | RF25 |

RF11 (lista de espera) no tiene caso de uso: queda para la segunda etapa.

### CU03 Reservar entradas
- **Actor:** Asistente. **Precondiciones:** sesión iniciada, evento publicado y en venta, quedan cupos.
- **Flujo principal:** 1) abre el evento y ve cupos por tipo (CU04); 2) elige tipo y cantidad; 3) aplica código de descuento si tiene (CU05); 4) pulsa "Reservar y pagar"; 5) el sistema descuenta los cupos **en una sola operación atómica** y crea la reserva con vencimiento a 10 min; 6) muestra la pantalla de pago con cuenta regresiva.
- **Alternos:** 3a código inválido o vencido: se rechaza, total sin descuento. 5a cupos agotados mientras elegía: avisa y propone cantidad menor. 6a pasan 10 min sin pago: la reserva vence y los cupos vuelven.
- **Postcondición:** reserva activa que retiene cupos hasta vencer o pagarse.
- **Reglas:** nunca se reserva más de lo disponible aunque haya concurrencia; la reserva dura 10 min.

### CU06 Pagar la orden
- **Actores:** Asistente, pasarela de pago. **Precondición:** reserva activa no vencida.
- **Flujo principal:** 1) revisa resumen y confirma nombre y correo; 2) acepta términos y política de datos; 3) elige tarjeta y va a la pasarela; 4) la pasarela cobra y notifica (webhook); 5) la orden pasa a pagada y la reserva se confirma; 6) se emite un ticket con QR firmado por entrada (CU07); 7) se envía comprobante y tickets por correo.
- **Alternos:** 4a rechazo: orden en "pago fallido", la reserva sigue hasta vencer, puede reintentar. 4b la pasarela no responde o el aviso llega repetido: se consulta el estado por id de orden; **no se cobra ni se emiten tickets dos veces (idempotencia)**. 4c la reserva vence antes de confirmar: se liberan cupos y, si el cobro llegó, se inicia reembolso.
- **Reglas:** un aviso repetido no genera tickets duplicados; no se guardan datos de tarjeta.

### CU20 Escanear y validar ticket
- **Actor:** Personal de acceso. **Precondiciones:** sesión iniciada, evento en curso, cámara; con conexión o con la lista del evento guardada en el celular.
- **Flujo principal:** 1) apunta la cámara al QR; 2) se verifica la firma (CU21); 3) se comprueba que el ticket es de este evento y está "válido, sin usar"; 4) se registra fecha y hora y se marca usado (CU22); 5) muestra "Ingreso permitido" con tipo de entrada y nombre.
- **Alternos:** 3a ya usado: "Ya fue usado" con hora del primer ingreso. 3b firma inválida u otro evento: "Ticket inválido". 3c invalidado por reembolso o cancelación: no válido. 1a sin conexión: valida contra la lista local (CU23) y deja el registro pendiente (CU24).
- **Regla y riesgo:** un ticket entra una sola vez; con varios lectores sin conexión podría pasar dos veces hasta sincronizar (R10).

---

## 8. Reglas de negocio

| ID | Regla |
|---|---|
| RN01 | Una reserva retiene cupos 10 minutos; al vencer se libera automáticamente |
| RN02 | El descuento de cupo es atómico: `disponible >= cantidad` se comprueba y descuenta en la misma operación |
| RN03 | Un evento solo se vende entre la fecha de inicio y fin de venta de cada tipo de entrada |
| RN04 | Un ticket por entrada; código único, firmado por el servidor, con estado `VALIDO`, `USADO` o `INVALIDADO` |
| RN05 | Un ticket permite un solo ingreso; un segundo escaneo muestra la hora del primero |
| RN06 | Las notificaciones de la pasarela se procesan de forma idempotente (clave: id de orden / id de pago) |
| RN07 | Cancelar un evento invalida todos sus tickets y genera reembolsos |
| RN08 | Un código de descuento tiene vigencia, porcentaje o monto y límite de usos |
| RN09 | Los datos de tarjeta nunca pasan por nuestros servicios |
| RN10 | Toda compra, reembolso, cambio de rol e invalidación queda en la bitácora |
| RN11 | Estados de la orden: `PENDIENTE_PAGO` → `PAGADA` / `PAGO_FALLIDO` / `EXPIRADA` → `REEMBOLSADA` |
| RN12 | Estados de la reserva: `ACTIVA` → `CONFIRMADA` / `EXPIRADA` / `CANCELADA` |

---

## 9. Procesos de negocio (para BPMN / Bizagi)

**P1. Publicar evento.** Organizador crea borrador → define tipos de entrada, precios, cupos y fechas de venta → (opcional) crea códigos de descuento → envía a publicación → administrador modera (aprueba / rechaza con motivo) → si aprueba, el evento queda publicado y visible en el catálogo.

**P2. Comprar entrada (Saga).** Asistente busca evento → consulta disponibilidad → reserva (inventario descuenta cupos, crea reserva 10 min) → órdenes crea orden `PENDIENTE_PAGO` → redirección a pasarela → *gateway exclusivo*: pago aprobado / rechazado / sin respuesta → aprobado: orden `PAGADA`, inventario confirma reserva, tickets emite QR, notificaciones envía correo → rechazado: orden `PAGO_FALLIDO`, puede reintentar mientras la reserva siga vigente → *evento de temporizador* 10 min: reserva `EXPIRADA`, cupos liberados, orden `EXPIRADA` (compensación; si llegó cobro tardío → reembolso).

**P3. Control de ingreso.** Personal abre pantalla de acceso → *gateway*: ¿hay conexión? → sí: validar en línea contra el servicio de acceso → no: validar contra lista local y encolar registro → *gateway*: válido / usado / inválido → registrar ingreso → al recuperar conexión, sincronizar pendientes y reportar conflictos (duplicados).

**P4. Cancelar evento y reembolsar.** Organizador cancela → eventos marca `CANCELADO` → tickets invalida todos → órdenes solicita reembolsos a la pasarela → notificaciones avisa a los asistentes → bitácora registra la acción.

Carriles (pools/lanes): Asistente, Organizador, Administrador, Personal de acceso, Plataforma (subcarriles por servicio), Pasarela de pago.

---

## 10. Arquitectura de referencia

> Propuesta técnica para el prototipo. Las tecnologías concretas están en el prompt (sección 14) y se pueden cambiar.

### Servicios (bounded contexts)

| Servicio | Responsabilidad | Datos propios | Publica eventos | Consume eventos |
|---|---|---|---|---|
| `gateway` | Entrada única, enrutamiento, HTTPS, límite de peticiones, validación de JWT | - | - | - |
| `auth` | Registro, login, verificación de correo, roles, emisión de JWT | usuarios, roles, sesiones | `usuario.registrado` | - |
| `catalog` | Eventos, tipos de entrada, descuentos, búsqueda, moderación | eventos, tipos_entrada, descuentos | `evento.publicado`, `evento.cancelado` | - |
| `inventory` | Cupos, reservas temporales, liberación automática | cupos, reservas | `reserva.creada`, `reserva.expirada`, `reserva.confirmada` | `orden.pagada`, `evento.publicado` |
| `orders` | Órdenes, integración con pasarela (simulada), reembolsos, webhook idempotente | ordenes, pagos, reembolsos | `orden.pagada`, `orden.fallida`, `orden.reembolsada` | `reserva.expirada`, `evento.cancelado` |
| `tickets` | Emisión de QR firmado, consulta, transferencia, invalidación | tickets | `ticket.emitido`, `ticket.invalidado` | `orden.pagada`, `orden.reembolsada`, `evento.cancelado` |
| `checkin` | Validación, registro de ingresos, paquete sin conexión, sincronización | ingresos | `ingreso.registrado` | `ticket.emitido`, `ticket.invalidado` |
| `notifications` | Correos (confirmación, recordatorio, cambios) | plantillas, envíos | - | `orden.pagada`, `evento.cancelado`, `usuario.registrado` |
| `reports` | Proyección de ventas, ingresos y ocupación para el panel; exportación | vistas de lectura | - | `orden.pagada`, `ingreso.registrado`, `orden.reembolsada` |
| `pwa` | Interfaz (asistente, organizador, acceso, admin), Service Worker, almacenamiento local | IndexedDB local | - | - |

Principios: una base de datos por servicio (pueden ser esquemas/BD separadas en una sola instancia Postgres para ahorrar recursos); comunicación síncrona solo para consultas; los flujos que cruzan servicios van por eventos; patrón *outbox* o publicación tras commit; consumidores idempotentes.

### QR firmado (propuesta)
Contenido: `{tid, eid, tipo, iat}` firmado con Ed25519 (o HMAC-SHA256 en el prototipo) por el servicio `tickets`. El lector verifica la firma con la clave pública incluida en el paquete sin conexión del evento, y el estado (usado/invalidado) contra la lista local o el servicio `checkin`.

### Despliegue
Un EC2 pequeño con Docker Compose: proxy inverso con HTTPS (Caddy/Traefik/Nginx), servicios, Postgres, broker de mensajes, Prometheus + Grafana + Loki (o equivalente ligero). Pipeline: lint → pruebas → build de imágenes → escaneo (Trivy) → push al registro → despliegue por SSH/compose → smoke test.

---

## 11. Seguridad

### Vulnerabilidades potenciales (OWASP Top 10:2021)

| ID | Vulnerabilidad | Dónde | Cómo se explotaría | Control |
|---|---|---|---|---|
| V1 | Control de acceso roto (A01) | Órdenes y tickets | Cambiar el id en la petición y ver datos ajenos (IDOR) | Verificar propiedad del recurso en cada consulta + roles |
| V2 | Autenticación débil (A07) | Usuarios | Fuerza bruta, sesiones sin vencimiento | Política de contraseñas, bloqueo temporal, JWT de vida corta |
| V3 | Tickets falsificables (A08) | Tickets y acceso | QR sin firma o sin estado, copiado y reusado | Código único firmado, estado y registro de cada ingreso |
| V4 | Condición de carrera (A04) | Inventario | Solicitudes concurrentes superan el aforo | Descuento atómico + pruebas de concurrencia |
| V5 | Inyección y XSS (A03) | Catálogo, búsqueda, formularios | Texto malicioso en nombre/descripción de evento | Validar y sanear entradas, escapar salidas, consultas parametrizadas |
| V6 | Confianza implícita entre servicios (A05) | Red interna | Servicio comprometido llama a otro sin autenticarse | Autenticar llamadas internas, mínimo privilegio |
| V7 | Secretos expuestos (A02, A05) | Repositorio, despliegue | Claves en código, imágenes o configuración | Secretos fuera del repo (`.env` no versionado), rotación, escaneo (gitleaks) |
| V8 | Dependencias vulnerables (A06) | Build y despliegue | Librería o imagen con CVE conocido | Escaneo de dependencias e imágenes en cada build |

### Política mínima de seguridad (12 reglas)

1. Acceso por roles y mínimo privilegio; verificar propiedad del recurso.
2. Autenticación segura: requisitos de contraseña, bloqueo tras intentos fallidos, sesiones con vencimiento, correo verificado.
3. Protección de datos: todo cifrado en tránsito, minimización, sin datos de tarjeta.
4. Tickets verificables: código único firmado y estado comprobado en cada ingreso.
5. Validación de entradas: todo dato del usuario se valida y sanea.
6. Comunicación interna autenticada.
7. Gestión de secretos fuera del código y las imágenes, con rotación.
8. Desarrollo seguro: revisión de código, escaneo de dependencias e imágenes, pruebas de seguridad antes de desplegar.
9. Registro y monitoreo de logins, compras, reembolsos y validaciones, sin datos sensibles en logs, con alertas.
10. Disponibilidad: respaldos con prueba de restauración, límite de peticiones, plan de escalado.
11. Gestión de incidentes: reportar, contener, corregir, documentar.
12. Revisión de la política al cierre de cada sprint.

Responsable de seguridad: líder técnico (Cesar). Ambos integrantes la cumplen.

### Datos personales (LOPDP Ecuador, 2021)

| Dato | Uso | Quién lo ve |
|---|---|---|
| Nombre y correo del asistente | Asociar compra, enviar comprobante y tickets | El asistente; el organizador de forma limitada |
| Historial de compras y tickets | Mostrar tickets, reclamos, reembolsos | El asistente y el administrador |
| Registros de ingreso | Evitar doble uso, contar asistencia | Personal de acceso; organizador en resumen |
| Credenciales | Iniciar sesión | Nadie (solo hash de la contraseña) |
| Datos de tarjeta | No se guardan | Los maneja la pasarela |

---

## 12. Restricciones, supuestos y riesgos

**Restricciones:** 10 semanas / 5 sprints; 2 personas; un solo EC2 sin servicios gestionados; pasarela solo en modo de pruebas; sin reventa, recomendaciones ni facturación electrónica; cumplimiento de la LOPDP.

| ID | Supuesto | Si no se cumple |
|---|---|---|
| S1 | Usuarios con celular y navegador actualizado e internet al comprar | Más trabajo de pruebas en equipos viejos |
| S2 | La pasarela tiene entorno de pruebas gratuito | Pasarela simulada propia |
| S3 | Hay organizadores y asistentes dispuestos a probar | Validar con compañeros de curso |
| S4 | El personal de acceso tiene celular con cámara | Otro lector o ingreso manual del código |
| S5 | Requisitos de prioridad alta estables tras el sprint 2 | Recortar prioridad media |
| S6 | La tutora revisa al cierre de cada sprint | Menos revisiones, más riesgo |
| S7 | Cuenta de AWS con servidor pequeño todo el proyecto | Contenedores en equipo local |

| ID | Riesgo | P | I | Nivel | Respuesta |
|---|---|---|---|---|---|
| R1 | Sobreventa en un pico | 3 | 3 | 9 Crítico | Bloqueo atómico, expiración automática, pruebas de concurrencia |
| R2 | Tickets falsificados o repetidos | 2 | 3 | 6 Alto | QR único firmado, estado, registro de ingreso |
| R3 | Fuga de datos personales | 2 | 3 | 6 Alto | Roles, verificación de propiedad, cifrado, sin tarjetas |
| R4 | Caída o lentitud en un pico | 3 | 2 | 6 Alto | Rate limit, escalar el servicio saturado, alertas |
| R5 | Secretos o dependencias vulnerables | 2 | 3 | 6 Alto | Secretos fuera del código, escaneo, mínimo privilegio |
| R6 | Alcance grande para dos personas | 3 | 3 | 9 Crítico | Priorizar reservas, tickets y acceso; recortar prioridad baja |
| R7 | Curva de aprendizaje de la coordinación entre servicios | 2 | 2 | 4 Medio | Versión simple del flujo en sprint 2, documentar decisiones |
| R8 | Cambios o demoras con la pasarela | 2 | 2 | 4 Medio | Cuenta de pruebas temprano + pasarela simulada con la misma interfaz |
| R9 | Costo del servidor mayor al previsto | 2 | 2 | 4 Medio | Instancia pequeña, apagar fuera de pruebas, alerta de costos |
| R10 | Doble ingreso con varios lectores sin conexión | 2 | 2 | 4 Medio | Sincronizar cada pocos minutos, lista por puerta, revisar duplicados al cierre |

Escala: probabilidad e impacto de 1 a 3; nivel = P × I (1-2 bajo, 3-4 medio, 6 alto, 9 crítico).

---

## 13. Indicadores y prototipo

### Indicadores

| Indicador | Cálculo | Meta | Cuándo |
|---|---|---|---|
| Cumplimiento del sprint | Historias terminadas / comprometidas × 100 | ≥ 80 % | Cierre de sprint |
| Cobertura de pruebas | % de líneas cubiertas | ≥ 70 % | Cada integración |
| Defectos críticos abiertos | Críticos o altos sin cerrar | 0 al cierre | Semanal |
| Tiempo de respuesta p95 | ms en reservas y compras | < 500 ms | Pruebas de carga |
| Sobreventas | Cupos vendidos sobre el disponible | 0 | Pruebas de concurrencia |
| Vulnerabilidades abiertas | Críticas y altas del escáner | 0 | Cada build |
| Disponibilidad del flujo de compra | Tiempo disponible / total × 100 | ≥ 99 % | Semanal |
| Tickets inválidos rechazados | Rechazados / intentos inválidos | 100 % | Pruebas de aceptación |
| Tiempo de compra | Minutos desde elegir hasta ver el ticket | < 3 min | Pruebas con usuarios |
| SUS | Cuestionario SUS | ≥ 68 | Sprints 4 y 5 |
| Acciones de mejora cerradas | Cerradas / acordadas × 100 | ≥ 80 % | Cierre de sprint |

### Pantallas del prototipo (mobile first)

| Pantalla | Usuario | Contenido | Requisitos |
|---|---|---|---|
| 1. Catálogo | Asistente | Buscador, filtros por categoría (chips), tarjetas con imagen, fecha, lugar, precio desde y cupos restantes; agotados visibles pero no comprables | RF06, RF07 |
| 2. Detalle y entradas | Asistente | Descripción, fecha, lugar, tipos de entrada con precio y cupos, selector de cantidad, campo de código de descuento, total en vivo, botón "Reservar y pagar" | RF05, RF07, RF13 |
| 3. Reserva y pago | Asistente | Cuenta regresiva de 10 min, resumen, datos del comprador, aceptar términos, pagar con tarjeta (pasarela de pruebas); transferencia como "próximamente" | RF08, RF12, RF14 |
| 4. Ticket | Asistente | Lista "Mis tickets", QR grande, estado, datos del evento, disponible sin conexión, botones transferir y descargar | RF17, RF18, RF19 |
| 5. Panel | Organizador | Entradas vendidas, recaudado, % de aforo, barras por tipo de entrada, exportar | RF04, RF25, RF26 |
| 6. Control de acceso | Personal | Visor de cámara, resultado grande en color (válido / ya usado / inválido), contador de ingresos, indicador de conexión y pendientes por sincronizar | RF21, RF22, RF23 |

Datos de ejemplo: nombres, precios y fechas ficticios en USD, ciudades de Ecuador (Quito, Sangolquí, Guayaquil, Cuenca).

---

## 14. Prompt para Claude Code: primer prototipo

Copiar el bloque completo en Claude Code, con este archivo ya guardado en `docs/base-conocimiento.md`.

````text
Eres el equipo técnico de un proyecto universitario. Lee primero docs/base-conocimiento.md completo: ahí están la problemática, requisitos (RF01-RF28, RNF01-RNF14), casos de uso (CU01-CU25), reglas de negocio (RN01-RN12), procesos, arquitectura de referencia, seguridad y las 6 pantallas del prototipo. Todo lo que construyas debe trazarse a esos IDs.

## Objetivo de esta entrega
Construir el PRIMER PROTOTIPO FUNCIONAL (incremento del sprint 2-3) que demuestre de punta a punta el recorrido principal:
publicar evento -> buscar -> reservar 10 min sin sobreventa -> pagar con pasarela SIMULADA -> recibir ticket con QR firmado -> validar el ingreso (también sin conexión) -> ver el panel del organizador.
No es el producto final: prioriza que el flujo funcione, sea seguro en lo básico y se pueda levantar con un solo comando.

## Stack (usa este salvo que te diga otra cosa)
- Monorepo con carpetas apps/ (pwa) y services/ (un servicio por carpeta), infra/ y docs/.
- Servicios: Node.js 20 + TypeScript + Fastify, validación con Zod, ORM ligero o SQL con pg. Cada servicio con su propia base de datos (bases separadas dentro de un solo contenedor PostgreSQL 16).
- Mensajería: NATS (o RabbitMQ) para eventos de dominio; consumidores idempotentes; patrón outbox simple en orders e inventory.
- Gateway: Caddy o Traefik como proxy inverso (HTTPS local con certificado interno) + validación de JWT en cada servicio.
- PWA: React + Vite + TypeScript + vite-plugin-pwa (Service Worker), IndexedDB (idb) para tickets y paquete de validación sin conexión, lector QR con @zxing/browser o html5-qrcode, generación de QR con la librería qrcode. Interfaz en español, mobile first, WCAG 2.1 AA (contraste, foco visible, etiquetas).
- Todo con Docker Compose. Un `make up` (o `docker compose up --build`) levanta todo con datos de ejemplo.

## Alcance del prototipo (en este orden de prioridad)
1. services/auth: registro, login, JWT de vida corta (15 min) + refresh, roles (ASISTENTE, ORGANIZADOR, ACCESO, ADMIN), bloqueo temporal tras 5 intentos fallidos, hash con argon2 o bcrypt. Usuarios semilla de cada rol. (RF01, RF03, RNF05)
2. services/catalog: CRUD de eventos y tipos de entrada (precio, cupo, fechas de venta), códigos de descuento, búsqueda y filtros, estado BORRADOR/PUBLICADO/CANCELADO. Publica evento.publicado y evento.cancelado. (RF04-RF06, RF13)
3. services/inventory: disponibilidad por tipo, reserva temporal de 10 min con descuento ATÓMICO (UPDATE ... SET disponible = disponible - :n WHERE id = :id AND disponible >= :n), job que expira reservas vencidas y devuelve cupos, confirmación al recibir orden.pagada. (RF07-RF10, RN01, RN02)
4. services/orders: crear orden desde una reserva, aplicar descuento, PASARELA SIMULADA (endpoint que aprueba o rechaza según el número de tarjeta de prueba y llama a un webhook), webhook IDEMPOTENTE, estados de orden según RN11, compensación cuando la reserva expira, reembolso al cancelar evento. Nunca recibir ni guardar datos de tarjeta reales. (RF12, RF14, RF15, RNF14, RN06, RN09)
5. services/tickets: al recibir orden.pagada emite un ticket por entrada con payload {tid, eid, tipo, iat} firmado con Ed25519 (clave privada solo en este servicio, por variable de entorno). Consulta "mis tickets" verificando que el ticket es del usuario. Invalidación por cancelación o reembolso. (RF17, RF18, RF20, RN04)
6. services/checkin: validar QR (firma + evento + estado), registrar ingreso una sola vez, endpoint que entrega el paquete sin conexión del evento (clave pública + lista de tickets válidos y su estado) y endpoint de sincronización por lotes que reporta duplicados. (RF21-RF23, RN05, R10)
7. services/notifications: consume eventos y "envía" correos a Mailpit (contenedor SMTP de pruebas). (RF16, RF24)
8. services/reports: proyección simple de ventas, recaudado, % de aforo e ingresos por evento para el panel; exportación CSV. (RF25, RF26)
9. apps/pwa: las 6 pantallas de la sección 13 + login + formulario del organizador para crear evento. El ticket y el paquete de validación quedan en IndexedDB y funcionan en modo avión. La pantalla de acceso muestra resultado grande en verde / ámbar / rojo, contador de ingresos e indicador "N pendientes por sincronizar".
Fuera de alcance ahora: lista de espera, transferencia de tickets (deja el botón deshabilitado con "próximamente"), moderación de admin (solo el rol existe), bitácora completa (deja un log estructurado de acciones críticas).

## Seguridad mínima obligatoria (sección 11)
- Verificar propiedad del recurso en órdenes y tickets (sin IDOR). Pruebas que lo demuestren.
- Validar y sanear toda entrada; escapar salidas; consultas parametrizadas.
- Llamadas entre servicios autenticadas (token de servicio o JWT firmado por auth con audiencia interna).
- Secretos solo en .env (con .env.example versionado, .env en .gitignore). Nada de claves en el código ni en imágenes.
- Rate limit en login y en reservas desde el gateway.
- Logs en JSON sin contraseñas, tokens ni datos personales completos.
- Cabeceras de seguridad (CSP, HSTS en el proxy, X-Content-Type-Options).

## Calidad y DevOps
- Pruebas: unitarias por servicio (Vitest), integración del flujo de compra, y una PRUEBA DE CONCURRENCIA (k6 o script Node) con 200 usuarios reservando el mismo tipo de entrada con cupo 50 que debe terminar con exactamente 50 reservas y cero sobreventa (RNF03). Prueba de webhook repetido que no duplica tickets (RNF14).
- GitHub Actions: lint + pruebas + build de imágenes + escaneo con Trivy (falla con CRITICAL) + gitleaks. Deja preparado (sin ejecutar) un job de despliegue por SSH a un EC2 con docker compose.
- Healthcheck /health en cada servicio y un docker-compose.observability.yml opcional con Prometheus + Grafana.
- OpenAPI por servicio (fastify-swagger) y un README en español: cómo levantar, usuarios de prueba, tarjetas de prueba de la pasarela simulada, cómo probar el modo sin conexión y qué RF/CU cubre cada pantalla y servicio.

## Datos semilla
3 eventos en Quito, Sangolquí y Guayaquil con 2-3 tipos de entrada cada uno (precios en USD), un código de descuento "ESPE10" (10 %), uno de los eventos casi agotado y otro agotado.

## Forma de trabajo
1. Antes de escribir código, propón en docs/arquitectura.md el árbol de carpetas, los contratos de API principales, el catálogo de eventos de dominio y el diagrama de la saga de compra (Mermaid). Espera mi confirmación.
2. Luego construye por incrementos en este orden: infraestructura base + auth -> catalog -> inventory (+ prueba de concurrencia) -> orders + pasarela simulada -> tickets -> checkin + modo sin conexión -> notifications -> reports -> pantallas de la PWA -> CI.
3. Al terminar cada incremento: levanta con docker compose, corre las pruebas, y resume qué RF/CU quedaron cubiertos y qué falta.
4. Commits pequeños en español con formato convencional (feat:, fix:, test:, chore:), SIN líneas Co-Authored-By.
5. Si algo de la base de conocimiento es ambiguo o contradictorio, pregúntame antes de decidir; si es menor, decide, anótalo en docs/decisiones.md (formato ADR corto) y sigue.
````

---

## 15. Decisiones abiertas

- Título y número exactos de la actividad en la carátula de la Propuesta del SI.
- Roles y fechas de los sprints son propuesta; ajustar al calendario de la asignatura.
- Pasarela real a usar en modo de pruebas (por definir en el sprint 1); mientras tanto, pasarela simulada.
- Comparación con plataformas concretas para respaldar la novedad (tarea del sprint 1).
- Stack definitivo: el prompt propone Node.js + TypeScript; se puede cambiar antes del sprint 2.

## Referencias

- Brooke, J. (1996). SUS: a "quick and dirty" usability scale. *Usability evaluation in industry*, 189-194.
- Cockburn, A. (2001). *Writing effective use cases*. Addison-Wesley.
- Ley Orgánica de Protección de Datos Personales. Registro Oficial Suplemento 459, 26 de mayo de 2021. Ecuador.
- Object Management Group. (2017). UML 2.5.1. https://www.omg.org/spec/UML/2.5.1
- OWASP Foundation. (2021). OWASP Top 10:2021. https://owasp.org/Top10/
- Schwaber, K., y Sutherland, J. (2020). La guía de Scrum. https://scrumguides.org
- W3C. (2018). WCAG 2.1. https://www.w3.org/TR/WCAG21/
