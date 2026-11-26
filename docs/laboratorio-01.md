# Laboratorio 01 · Del modelo de datos al primer CRUD REST (adaptado a Aforo)

La guía de la docente usa un sistema bibliotecario con NestJS + TypeORM. Aforo ya tiene su backend en **Fastify 5 + SQL** (ver [ADR-001](decisiones.md)), así que el laboratorio se adapta así:

| Guía | Aforo |
|---|---|
| Ramas `master`, `pruebas`, `desarrollo` | `main` (estable), `pruebas`, `desarrollo` |
| `docker-compose.yml` solo con PostgreSQL 17 | `compose.yaml` con toda la plataforma; PostgreSQL 16, una base por servicio |
| Tablas `persona`, `usuario`, `rol`, `usuario_rol` creadas a mano en psql | `personas`, `usuarios`, `roles`, `usuario_roles` en el servicio `auth`; la migración se ejecuta al arrancar (`services/auth/src/index.js`) |
| `nest g resource persona` (módulo, DTO, entidad, controller, service) | Rutas `/personas` en `auth`; el esquema JSON de cada ruta cumple el papel del DTO y `class-validator` |
| `database/01_schema.sql` | [`database/01_schema.sql`](../database/01_schema.sql) |
| Sin autenticación | Solo el rol `ADMIN` gestiona personas (son datos personales) |

## Modelo y reglas

- **Persona ≠ Usuario.** `personas` guarda los datos personales y `usuarios` las credenciales. Una persona puede no tener cuenta. Cada usuario corresponde a una sola persona (`usuarios.persona_id` es `UNIQUE`).
- **Usuario N:M Rol.** `usuario_roles` resuelve la relación con `UNIQUE (usuario_id, rol_id)`. Por ahora la aplicación usa un rol vigente por usuario (la vista `cuentas` toma el más reciente).
- **Integridad.** No se puede eliminar una persona que tiene cuenta (FK → `409`). La identificación es única (`409`) y el correo debe ser válido (`400`).
- **Entre servicios no hay FK física.** Por ejemplo, `ordenes.usuario_id` → `usuarios.id` se valida por API y eventos.

Las bases creadas con el esquema anterior (`usuarios.nombre`, `usuarios.rol`) se migran solas al arrancar, sin perder cuentas.

## Comandos

```powershell
# Ramas
git branch pruebas
git switch -c desarrollo
git push -u origin pruebas
git push -u origin desarrollo

# Plataforma (antes, una sola vez: npm run env)
docker version
docker compose up -d --build
docker compose ps
docker compose exec postgres psql -U postgres -d auth -c "\dt"

# Exportar el esquema de auth a database/01_schema.sql (desde una base limpia)
docker compose exec postgres psql -U postgres -c "CREATE DATABASE auth_nueva OWNER auth"
# en otra terminal, hasta ver "Server listening", luego Ctrl+C:
docker compose run --rm --no-deps -e DATABASE_URL=postgres://auth:<DB_PASS_AUTH>@postgres:5432/auth_nueva auth
docker compose exec -T postgres pg_dump -U postgres -d auth_nueva --schema-only --no-owner --no-privileges > database/01_schema.sql
docker compose exec postgres psql -U postgres -c "DROP DATABASE auth_nueva WITH (FORCE)"
# pg_dump 16.10+ agrega líneas \restrict con una clave aleatoria: se borran para que el archivo no cambie en cada exportación
```

## Pruebas REST con PowerShell 7

Las peticiones pasan por Traefik (`https://localhost/api/auth`). En local el certificado es autofirmado, por eso se usa `-SkipCertificateCheck` (solo existe en PowerShell 7).

```powershell
$api = "https://localhost/api/auth"
# Iniciar sesión como administrador (contraseña: SEED_PASSWORD del .env)
$login = @{ correo = "admin@eventos.ec"; password = "<SEED_PASSWORD>" } | ConvertTo-Json
$token = (Invoke-RestMethod "$api/login" -Method Post -ContentType "application/json" -Body $login -SkipCertificateCheck).accessToken
$h = @{ Authorization = "Bearer $token" }

# POST: crear persona
$persona = @{ nombres = "Ana"; apellidos = "Perez"; identificacion = "PRUEBA-001"; correo = "ana.prueba@example.com"; telefono = "0991234567" } | ConvertTo-Json
Invoke-RestMethod "$api/personas" -Method Post -Headers $h -ContentType "application/json" -Body $persona -SkipCertificateCheck

# GET: listar y obtener el id por identificación
$personas = Invoke-RestMethod "$api/personas" -Headers $h -SkipCertificateCheck
$id = ($personas | Where-Object { $_.identificacion -eq "PRUEBA-001" }).id
Invoke-RestMethod "$api/personas/$id" -Headers $h -SkipCertificateCheck

# PATCH: actualizar el teléfono
$datos = @{ telefono = "0987654321" } | ConvertTo-Json
Invoke-RestMethod "$api/personas/$id" -Method Patch -Headers $h -ContentType "application/json" -Body $datos -SkipCertificateCheck

# DELETE y comprobar 404
Invoke-RestMethod "$api/personas/$id" -Method Delete -Headers $h -SkipCertificateCheck
try { Invoke-RestMethod "$api/personas/$id" -Headers $h -SkipCertificateCheck }
catch { Write-Host "Código HTTP:" ([int]$_.Exception.Response.StatusCode); Write-Host "Detalle:" $_.ErrorDetails.Message }

# Validación: correo inválido -> 400
$malo = @{ nombres = "Carlos"; apellidos = "Lopez"; identificacion = "PRUEBA-002"; correo = "correo-invalido" } | ConvertTo-Json
try { Invoke-RestMethod "$api/personas" -Method Post -Headers $h -ContentType "application/json" -Body $malo -SkipCertificateCheck }
catch { Write-Host "Código HTTP:" ([int]$_.Exception.Response.StatusCode); Write-Host "Detalle:" $_.ErrorDetails.Message }
```

Las mismas comprobaciones (y además: identificación duplicada → 409, un no administrador → 403, no se elimina una persona con cuenta → 409) se ejecutan de forma automática con `npm run pruebas` (`tests/flujo.mjs`).

## Siguientes incrementos

| Incremento | Alcance |
|---|---|
| Rol | CRUD de `/roles`; validar el rol contra la tabla en lugar de la lista fija `ROLES`. |
| Usuario | Crear una cuenta para una persona existente; desactivar (`estado`) en lugar de borrar. |
| UsuarioRol | Asignar y revocar varios roles a la vez; el JWT pasa a llevar la lista de roles. |
