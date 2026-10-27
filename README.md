# Aforo · Plataforma de gestión de eventos

Plataforma web (PWA) para publicar eventos locales, reservar y vender entradas **sin sobreventa**, emitir tickets con **QR firmado** y controlar el ingreso **incluso sin conexión**. Son microservicios coordinados por eventos y desplegados con Docker en un solo servidor.

Proyecto de la asignatura **Construcción y evolución del software** (NRC 36847), Carrera de Ingeniería de Software, ESPE.
**Tutora:** Mayra Isabel Alvarez Jimenez · **Equipo:** Cesar Ignacio Loor Mercado, Kevin David Asmal Haro

> Primer prototipo funcional. El stack y las decisiones están en [`docs/decisiones.md`](docs/decisiones.md); la arquitectura, en [`docs/arquitectura.md`](docs/arquitectura.md).

## Levantar en local

Requisitos: Docker y Node.js 22.

```bash
npm run env                    # crea .env con contraseñas y claves aleatorias (imprime la contraseña de los usuarios semilla)
docker compose up -d --build   # levanta los 9 servicios, la PWA, Postgres, NATS, Traefik y Mailpit
```

- App: **https://localhost** (en local el certificado es autofirmado; acepta la advertencia del navegador)
- Correos de prueba (Mailpit): http://localhost:8025
- OpenAPI de cada servicio: `docker compose exec <servicio> wget -qO- localhost:3000/docs/json`

### Usuarios de prueba

Todos usan la contraseña `SEED_PASSWORD` del `.env`.

| Rol | Correo |
|---|---|
| Asistente | `asistente@eventos.ec` (y `asistente2@eventos.ec`) |
| Organizador | `organizador@eventos.ec` |
| Personal de acceso | `acceso@eventos.ec` |
| Administración | `admin@eventos.ec` |

Hay 3 eventos de ejemplo:
- Noche de Jazz en La Ronda (Quito), casi agotado.
- Feria Gastronómica del Valle (Sangolquí).
- Festival Malecón Sonoro (Guayaquil), agotado.

El código `ESPE10` da un 10 % de descuento.

### Tarjetas de la pasarela simulada

| Tarjeta | Resultado |
|---|---|
| `4242 4242 4242 4242` | Aprueba |
| `4000 0000 0000 0002` | Rechaza: la orden queda en PAGO_FALLIDO y se puede reintentar |
| `4000 0000 0000 9995` | Aprueba sin enviar el aviso: la plataforma consulta el estado sola |
| `4000 0000 0000 0259` | Aprueba y envía el aviso **dos veces**: no se duplican tickets ni correos |

### Probar el modo sin conexión
1. Entra como `acceso@eventos.ec`, abre **Acceso**, elige el evento y pulsa **Guardar lista**.
2. Activa el modo avión, o marca **Simular sin conexión**.
3. Escanea un QR con la cámara o pega su código. La firma se verifica en el teléfono y el ingreso queda como pendiente.
4. Vuelve a conectarte y pulsa **Sincronizar**. Si otro lector ya registró el mismo ticket, se informa como duplicado.

El asistente ve sus tickets en **Mis tickets** aunque no tenga conexión, porque quedan guardados en el teléfono.

## Pruebas

```bash
npm run lint && npm test        # lint y pruebas unitarias (firma del QR y del webhook)
npm run pruebas                 # dentro de Docker: concurrencia (200 usuarios, cupo 50) y flujo completo
```

`npm run pruebas` comprueba lo siguiente:

| Área | Qué se verifica |
|---|---|
| Concurrencia | Exactamente 50 reservas, 0 sobreventas y p95 < 500 ms (RNF01-RNF03) |
| Pagos | Un webhook repetido no duplica tickets ni correos (RNF14) |
| Acceso a datos | Sin IDOR en órdenes, reservas y tickets (V1) |
| Ingreso | Ingreso único; un QR alterado o de otro evento se rechaza (RN05, RNF07); la sincronización detecta duplicados (R10) |
| Cuentas y servicios | Bloqueo tras 3 intentos fallidos (RNF05); las rutas internas requieren token de servicio (V6) |

## Trazabilidad

| Pantalla o servicio | RF | CU |
|---|---|---|
| Iniciar sesión · `auth` | RF01, RF03 | CU01, CU18 |
| 1 Catálogo · `catalog` + `inventory` | RF06, RF07 | CU02, CU04 |
| 2 Detalle y entradas · `inventory` | RF05, RF08-RF10, RF13 | CU03, CU05 |
| 3 Reserva y pago · `orders` + `payment-sim` | RF12, RF14, RF16 | CU06 |
| 4 Ticket · `tickets` | RF17, RF18 (RF19 próximamente) | CU07, CU08 |
| 5 Panel y nuevo evento · `catalog` + `reports` | RF04, RF15, RF20, RF25, RF26 | CU10-CU16 |
| 6 Control de acceso · `checkin` | RF21-RF23 | CU20-CU25 |
| Correos · `notifications` | RF16, RF24 | CU06 |

## Seguridad

- **Gateway (Traefik):**
  - HTTPS con HSTS, CSP estricta y `X-Content-Type-Options`.
  - Límite de peticiones: login y registro, 5 por minuto; reservas, 20 por minuto.
  - Las rutas `/internal` responden 403 desde afuera.
- **Sesiones:** JWT EdDSA de 15 min que vive solo en memoria. La renovación usa una cookie HttpOnly rotativa y detecta si un token se reutiliza. La cuenta se bloquea tras 3 intentos fallidos.
- **Datos:**
  - Cada servicio usa su propia base y su propio usuario de Postgres.
  - Las consultas son parametrizadas y cada ruta valida con JSON Schema, descartando los campos que no declara.
  - Los recursos se buscan por id **y** dueño, sin IDOR.
- **Pagos:** el webhook va firmado con HMAC y es idempotente por id de pago. Los datos de tarjeta nunca llegan a la plataforma.
- **Contenedores:** corren sin root, con sistema de archivos de solo lectura, `cap_drop: ALL` y `no-new-privileges`.
- **Secretos y dependencias:** los secretos están solo en `.env`, que no se versiona. CI ejecuta gitleaks, Trivy (falla con CRITICAL) y `npm audit`.
- **Logs:** se escriben en JSON, sin contraseñas, tokens, QR ni correos. Las acciones críticas quedan marcadas con `accion` (RN10).

## Despliegue en AWS

- `infra/deploy/crear-ec2.sh` crea el servidor con IaC mínima: grupo de seguridad, clave SSH, EC2 con Docker, IP elástica y EC2 Instance Connect Endpoint.
- El puerto 22 no queda abierto a internet; se entra con `ssh eventos-ec2`.
- En el servidor hay que generar el `.env` con `node scripts/generar-env.mjs --domain <ip-con-guiones>.sslip.io` para obtener el certificado de Let's Encrypt.
- El job `desplegar` del pipeline está preparado y se habilita con la variable `DESPLIEGUE_HABILITADO`.

## Documentación

| Archivo | Contenido |
|---|---|
| [`docs/base-conocimiento.md`](docs/base-conocimiento.md) | Problemática, objetivos, RF01-RF28, RNF01-RNF14, CU01-CU25, reglas, riesgos y pantallas |
| [`docs/arquitectura.md`](docs/arquitectura.md) | Carpetas, API, eventos de dominio y saga de compra |
| [`docs/decisiones.md`](docs/decisiones.md) | Stack y ADR |
| [`docs/procesos/`](docs/procesos/LEEME.md) | BPMN 2.0 y modelos de Bizagi |
| [`docs/entregables/`](docs/entregables/) | PDF de las actividades entregadas |
