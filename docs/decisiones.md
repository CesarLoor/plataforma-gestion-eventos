# Decisiones de arquitectura (ADR cortos)

Formato: contexto → decisión → consecuencia. Estado: **aceptada** salvo que se indique otra cosa.

## Stack del proyecto

| Capa | Tecnología | Versión | Por qué |
|---|---|---|---|
| Servicios | Node.js + Fastify, JavaScript (ESM) | Node 22 LTS, Fastify 5 | Un mismo lenguaje en servicios y PWA; Fastify valida cada ruta con JSON Schema y genera OpenAPI |
| Base de datos | PostgreSQL, **una base y un usuario por servicio** | 16 | Transacciones y `UPDATE ... WHERE disponible >= n` atómico para no sobrevender |
| Mensajería | NATS JetStream | 2.10 | Liviano para un solo servidor; persistencia, consumidores durables y descarte de duplicados |
| Gateway | Traefik | 3.3 | HTTPS (Let's Encrypt), límite de peticiones y cabeceras de seguridad incluidos |
| Interfaz | React + Vite + vite-plugin-pwa | React 18, Vite 6 | PWA instalable, Service Worker e IndexedDB para el modo sin conexión |
| Correo de pruebas | Mailpit | 1.21 | Recibe los correos sin enviarlos a nadie |
| Contenedores | Docker Compose | — | Todo se levanta con un comando, en local o en el EC2 |
| Infraestructura | AWS EC2 c7i-flex.large, Ubuntu 24.04 | — | Un solo servidor, sin servicios gestionados (restricción del proyecto) |
| CI/CD | GitHub Actions + Trivy + gitleaks | — | Lint, pruebas, imágenes, escaneo de vulnerabilidades y secretos en cada push |

### Microservicios

| Servicio | Base de datos | Publica | Consume |
|---|---|---|---|
| `auth` | auth | `usuario.registrado` | — |
| `catalog` | catalog | `evento.publicado`, `evento.cancelado` | `orden.pagada` (usos del descuento) |
| `inventory` | inventory | `reserva.expirada` | `evento.publicado`, `evento.cancelado` |
| `orders` | orders | `orden.pagada`, `orden.fallida`, `orden.reembolsada` | `reserva.expirada`, `evento.cancelado` |
| `payment-sim` | memoria | webhook firmado a `orders` | — |
| `tickets` | tickets | `ticket.emitido`, `ticket.invalidado` | `orden.pagada`, `orden.reembolsada`, `evento.cancelado`, `ingreso.registrado` |
| `checkin` | checkin | `ingreso.registrado` | `ticket.emitido`, `ticket.invalidado` |
| `notifications` | notifications | — | `usuario.registrado`, `orden.pagada`, `orden.reembolsada` |
| `reports` | reports | — | `evento.publicado`, `orden.pagada`, `orden.reembolsada`, `ingreso.registrado` |

Código compartido en `packages/common`: app HTTP, outbox, consumidor idempotente, verificación de JWT y firmas.

---

## ADR-001 · JavaScript con JSON Schema en lugar de TypeScript con Zod
- **Contexto:** el prompt original proponía TypeScript y Zod. El prototipo debía estar listo en una noche.
- **Decisión:** JavaScript ESM sin paso de compilación. La validación usa el JSON Schema nativo de Fastify (con `removeAdditional`, que descarta campos no declarados), que además genera el OpenAPI en `/docs`.
- **Consecuencia:** menos herramientas y builds. Se puede migrar a TypeScript por servicio sin cambiar contratos.

## ADR-002 · NATS JetStream con outbox y consumidores idempotentes (D1)
- **Decisión:** cada servicio escribe sus eventos en la tabla `outbox` dentro de la misma transacción del cambio. Un relay los publica con `Nats-Msg-Id`, y cada consumidor guarda el id en `mensajes_procesados` en la transacción que aplica el efecto.
- **Consecuencia:** un evento repetido no duplica tickets, correos ni ventas (RNF14). Si un servicio secundario cae, la compra sigue (RNF04).

## ADR-003 · Confirmación síncrona de la reserva al pagar (D5)
- **Decisión:** `orders` llama a `POST /internal/reservations/:id/confirm` antes de marcar la orden como PAGADA. Esa sentencia y el job de expiración se excluyen por el estado de la fila.
- **Consecuencia:** nunca se emiten tickets de una reserva vencida. Si el cobro llega tarde, se reembolsa solo (CU06 4c).

## ADR-004 · Token entre servicios con un secreto compartido
- **Decisión:** las rutas `/internal/*` exigen un JWT HS256 de 60 s con `aud=internal` y `sub=<servicio>`, y cada ruta declara qué servicios acepta. Traefik bloquea `/internal` desde afuera (403).
- **Atajo:** un solo `INTERNAL_JWT_SECRET` para todos. **Mejora:** un par de claves por servicio o mTLS cuando haya más de un servidor.

## ADR-005 · Sesión: token de acceso en memoria y renovación en cookie HttpOnly
- **Decisión:** JWT EdDSA de 15 min que solo vive en memoria de la PWA. El token de renovación es rotativo, va en una cookie `HttpOnly; Secure; SameSite=Strict` y se guarda en la base como hash. Si un token ya usado reaparece, se cierran todas las sesiones del usuario.
- **Consecuencia:** un XSS no puede leer tokens guardados. Tras 3 intentos fallidos la cuenta se bloquea 15 min (`MAX_INTENTOS`), igual que en el BPMN 01.

## ADR-006 · QR firmado con Ed25519 y verificación sin conexión con WebCrypto
- **Decisión:** el QR es `base64url(payload).base64url(firma)`. Solo `tickets` tiene la clave privada. `checkin` y la PWA verifican con la pública, y la PWA lo hace con WebCrypto, sin librerías.
- **Consecuencia:** un QR alterado o inventado se rechaza aunque no haya internet. Riesgo R10: dos lectores sin conexión pueden dejar pasar el mismo ticket hasta sincronizar. La sincronización lo detecta y lo informa.

## ADR-007 · Pasarela simulada como servicio externo con su propia página (D7)
- **Decisión:** `payment-sim` muestra su página de pago bajo `/pasarela`, firma el webhook con HMAC-SHA256 y ofrece tarjetas de prueba para aprobar, rechazar, no avisar y avisar dos veces.
- **Atajo:** guarda sesiones en memoria. **Mejora:** reemplazarla por una pasarela real en modo de pruebas con la misma interfaz (riesgo R8).

## ADR-008 · SSH por EC2 Instance Connect Endpoint
- **Contexto:** el operador usa CGNAT, así que una regla de SSH por IP no funciona y abrir el 22 a internet no es aceptable.
- **Decisión:** el puerto 22 solo acepta conexiones desde el endpoint. Se entra con `ssh eventos-ec2`.

## ADR-009 · Dependencias con 2 semanas de antigüedad, salvo correcciones de seguridad
- **Decisión:** `npm install --before=<hoy - 14 días>` para reducir el riesgo de cadena de suministro. **Excepción:** nodemailer 10.2.1, que corrige vulnerabilidades altas; ninguna versión más antigua las corrige.

## ADR-010 · Alcance del prototipo
- **Incluido:** RF01, RF03-RF10, RF12-RF18, RF20-RF26; CU01-CU08, CU10-CU16, CU20-CU25.
- **Pendiente:**
  - RF02: verificación de correo y recuperación de contraseña.
  - RF11: lista de espera.
  - RF19: transferencia (el botón aparece como "próximamente").
  - RF27: moderación.
  - RF28: bitácora con pantalla. Las acciones críticas ya quedan en logs JSON con `accion`.
  - Observabilidad con Prometheus y Grafana.
- **Semillas:** los ids fijos de usuarios, eventos y tipos de entrada se repiten en catalog, inventory y reports para que los números coincidan entre servicios.
