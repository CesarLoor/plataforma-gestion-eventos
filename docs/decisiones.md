# Decisiones (ADR cortos)

## ADR-001 · Laboratorio 01 en Fastify, no en NestJS (2026-11-24)

**Contexto.** La guía del segundo parcial usa NestJS + TypeORM. Aforo ya tiene 9 microservicios en Fastify 5 con SQL directo, outbox y pruebas de integración.

**Decisión.** El CRUD se construye en el servicio `auth` que ya existe. El esquema JSON de cada ruta cumple el papel del DTO y la migración SQL al arrancar el de la entidad TypeORM.

**Consecuencias.** Un solo stack que mantener y ningún servicio duplicado. Lo que no se ve es la estructura de módulos de NestJS que muestra la guía.

## ADR-002 · Persona, usuario y roles separados (2026-11-24)

**Contexto.** `usuarios` mezclaba datos personales y credenciales, y el rol era texto con `CHECK`: un usuario solo podía tener un rol y agregar uno nuevo obligaba a cambiar el esquema.

**Decisión.** Las tablas quedan `personas` 1:0..1 `usuarios` N:M `roles` (vía `usuario_roles` con `UNIQUE (usuario_id, rol_id)`). La vista `cuentas` entrega nombre y rol vigente, así el login y el JWT no cambian. Las bases existentes se migran una sola vez al arrancar, dentro de la misma transacción.

**Consecuencias.** Los roles pasan a ser datos y una persona puede existir sin cuenta. Por ahora la aplicación usa un rol vigente por usuario; habilitar varios a la vez obliga a que el JWT lleve la lista de roles (incremento UsuarioRol).
