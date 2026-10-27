# Operación: infraestructura y DevOps

Runbook del servidor del proyecto. Los comandos `aws` necesitan el AWS CLI configurado (`aws configure`) con un usuario IAM con permisos de EC2.

## 1. Datos del servidor

| Dato | Valor |
|---|---|
| Aplicación | **https://34-230-232-119.sslip.io** |
| Región | `us-east-1` (N. Virginia) |
| Instancia | `i-024c53a725e913ed8`, nombre `plataforma-eventos` |
| Tipo | `c7i-flex.large`: 2 vCPU, 4 GB de RAM + 2 GB de swap, 20 GB de disco cifrado |
| Sistema | Ubuntu 24.04 LTS, Docker y Docker Compose |
| IP elástica | `34.230.232.119` (no cambia al apagar y encender) |
| Grupo de seguridad de la instancia | `sg-0b027b646bed393a2`: 80 y 443 públicos; 22 solo desde el endpoint |
| EC2 Instance Connect Endpoint | `eice-074386694700fca3b`, con su grupo `sg-00c73d973b20b5adb` |
| Clave SSH | `~/.ssh/eventos-ec2.pem` (ED25519). Solo existe en tu equipo: **no la compartas ni la subas** |
| Carpeta del proyecto en el servidor | `/opt/plataforma-eventos` |

`sslip.io` es un DNS gratuito: `34-230-232-119.sslip.io` resuelve a `34.230.232.119`. Con un nombre de dominio, Traefik obtiene un certificado de Let's Encrypt. Con la IP sola no se puede, y sin HTTPS no funcionan ni la cámara ni la PWA.

## 2. Usuarios de la aplicación

| Rol | Correo | Qué puede hacer |
|---|---|---|
| Asistente | `asistente@eventos.ec` | Comprar y ver sus tickets |
| Asistente 2 | `asistente2@eventos.ec` | Lo mismo; sirve para demostrar que no ve datos ajenos |
| Organizador | `organizador@eventos.ec` | Crear, publicar y cancelar eventos; ver el panel y exportar |
| Personal de acceso | `acceso@eventos.ec` | Validar tickets en línea y sin conexión |
| Administración | `admin@eventos.ec` | Todo lo anterior y cambiar roles |

Todos comparten una contraseña, que es distinta en cada servidor y no está en el repositorio. Para verla:

```bash
ssh eventos-ec2 'grep SEED_PASSWORD /opt/plataforma-eventos/.env'
```

## 3. Entrar al servidor (SSH)

El puerto 22 no está abierto a internet. Se entra por el **EC2 Instance Connect Endpoint**, que funciona aunque tu IP cambie (CGNAT). Con este bloque en `~/.ssh/config` (ya está en tu equipo):

```
Host eventos-ec2
  HostName i-024c53a725e913ed8
  User ubuntu
  IdentityFile ~/.ssh/eventos-ec2.pem
  ProxyCommand aws ec2-instance-connect open-tunnel --instance-id %h --region us-east-1
```

basta con:

```bash
ssh eventos-ec2                       # consola del servidor
ssh eventos-ec2 'docker compose -f /opt/plataforma-eventos/compose.yaml ps'   # un comando suelto
```

En otro equipo hay que copiar la clave `.pem` (con permisos solo para tu usuario), agregar ese bloque y tener el AWS CLI configurado.

## 4. Encender, apagar y estado de la instancia

```bash
# Estado
aws ec2 describe-instances --instance-ids i-024c53a725e913ed8 --query "Reservations[0].Instances[0].State.Name" --output text

# Encender (los contenedores arrancan solos: restart: unless-stopped)
aws ec2 start-instances --instance-ids i-024c53a725e913ed8
aws ec2 wait instance-running --instance-ids i-024c53a725e913ed8

# Apagar (deja de consumir horas de cómputo; los datos y la IP se conservan)
aws ec2 stop-instances --instance-ids i-024c53a725e913ed8
aws ec2 wait instance-stopped --instance-ids i-024c53a725e913ed8
```

Desde la consola web: EC2 → Instances → `plataforma-eventos` → Instance state.

### Cambiar el tamaño (si falta memoria)

```bash
aws ec2 stop-instances --instance-ids i-024c53a725e913ed8 && aws ec2 wait instance-stopped --instance-ids i-024c53a725e913ed8
aws ec2 modify-instance-attribute --instance-id i-024c53a725e913ed8 --instance-type "{\"Value\": \"m7i-flex.large\"}"   # 8 GB
aws ec2 start-instances --instance-ids i-024c53a725e913ed8
```

Para ver el uso actual de memoria: `ssh eventos-ec2 'free -h && docker stats --no-stream'`.

## 5. Arrancar y administrar el proyecto en el servidor

Todo se hace dentro de `/opt/plataforma-eventos`:

```bash
ssh eventos-ec2
cd /opt/plataforma-eventos

docker compose up -d                  # arrancar todo (o reconstruir con --build)
docker compose ps                     # estado y healthchecks
docker compose logs -f orders         # logs de un servicio (JSON)
docker compose logs --tail=100        # últimos logs de todos
docker compose restart inventory      # reiniciar un servicio
docker compose stop                   # detener todo sin borrar datos
docker compose down                   # detener y quitar contenedores (los datos quedan en los volúmenes)
docker compose --profile pruebas run --rm pruebas   # pruebas de concurrencia y del flujo completo en el servidor
```

**Correos de prueba (Mailpit):** escuchan solo dentro del servidor. Se abren con un túnel:

```bash
ssh -L 8025:127.0.0.1:8025 eventos-ec2   # deja esta ventana abierta y entra a http://localhost:8025
```

## 6. Desplegar una nueva versión

Desde tu equipo, en la carpeta del repositorio y con los cambios ya en un commit:

```bash
bash infra/deploy/desplegar.sh
```

El script copia el commit actual al servidor por el túnel SSH. La primera vez crea el `.env` del servidor y luego ejecuta `docker compose up -d --build`. El `.env` con las contraseñas y claves se crea **en el servidor** y nunca se copia.

El job `desplegar` de GitHub Actions hace lo mismo. Está preparado, pero para usarlo hay que configurar:
- un rol IAM con OIDC (`AWS_ROLE_ARN`);
- los secretos `EC2_INSTANCE_ID` y `EC2_SSH_KEY`;
- la variable `DESPLIEGUE_HABILITADO=true`.

## 7. Respaldos de la base de datos

```bash
# Respaldo de todas las bases a tu equipo
ssh eventos-ec2 'cd /opt/plataforma-eventos && docker compose exec -T postgres pg_dumpall -U postgres' | gzip > respaldo-$(date +%F).sql.gz

# Restaurar en un servidor limpio
gunzip -c respaldo-AAAA-MM-DD.sql.gz | ssh eventos-ec2 'cd /opt/plataforma-eventos && docker compose exec -T postgres psql -U postgres'
```

## 8. Problemas frecuentes

| Síntoma | Qué revisar |
|---|---|
| `ssh eventos-ec2` no responde | La instancia está apagada (sección 4) o el AWS CLI no tiene credenciales (`aws sts get-caller-identity`) |
| El navegador muestra error de certificado | Los primeros minutos Traefik está pidiendo el certificado: `docker compose logs traefik \| grep -i acme` |
| Un servicio aparece `unhealthy` | `docker compose logs <servicio>`; en el primer arranque esperan a que Postgres termine de crear las bases |
| El login responde 429 | El límite de 5 intentos por minuto por IP; espera un minuto |
| La cuenta dice "bloqueada" | 5 contraseñas incorrectas seguidas: se desbloquea sola en 15 min |
| Disco lleno | `docker system prune -af` (borra imágenes viejas; no toca los volúmenes de datos) |

## 9. Costos

- **Capa gratuita:** la `c7i-flex.large` consume créditos mientras está encendida. Apágala cuando no la uses.
- **IP elástica:** AWS cobra unos USD 0,005 por hora, encendida o apagada.
- **Instance Connect Endpoint:** es gratuito.
- **Alerta recomendada:** configura una en Billing → Budgets (por ejemplo, USD 5 al mes).

## 10. Borrar toda la infraestructura (al cerrar el proyecto)

```bash
aws ec2 terminate-instances --instance-ids i-024c53a725e913ed8 && aws ec2 wait instance-terminated --instance-ids i-024c53a725e913ed8
aws ec2 release-address --allocation-id $(aws ec2 describe-addresses --public-ips 34.230.232.119 --query "Addresses[0].AllocationId" --output text)
aws ec2 delete-instance-connect-endpoint --instance-connect-endpoint-id eice-074386694700fca3b
aws ec2 delete-security-group --group-id sg-00c73d973b20b5adb   # cuando el endpoint ya no exista
aws ec2 delete-security-group --group-id sg-0b027b646bed393a2
aws ec2 delete-key-pair --key-name eventos-ec2
```
