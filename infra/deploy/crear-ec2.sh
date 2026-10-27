#!/usr/bin/env bash
# Crea el servidor EC2 del proyecto: grupo de seguridad, clave SSH, instancia con Docker e IP elástica.
# Uso: bash infra/deploy/crear-ec2.sh   (requiere AWS CLI con credenciales; región por defecto us-east-1)
set -euo pipefail

NOMBRE="${NOMBRE:-plataforma-eventos}"
TIPO="${TIPO:-c7i-flex.large}"
CLAVE="${CLAVE:-eventos-ec2}"
ARCHIVO_CLAVE="${ARCHIVO_CLAVE:-$HOME/.ssh/$CLAVE.pem}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"
export MSYS_NO_PATHCONV=1  # Git Bash en Windows reescribe /aws/... como ruta local

MI_IP="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
VPC="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
AMI="$(aws ssm get-parameter --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query Parameter.Value --output text)"

# Clave SSH (la privada queda solo en este equipo)
if [ ! -f "$ARCHIVO_CLAVE" ]; then
  mkdir -p "$(dirname "$ARCHIVO_CLAVE")"
  aws ec2 create-key-pair --key-name "$CLAVE" --key-type ed25519 --query KeyMaterial --output text | tr -d '\r' > "$ARCHIVO_CLAVE"  # el CLI en Windows escribe CRLF y OpenSSH lo rechaza
  chmod 600 "$ARCHIVO_CLAVE"
fi

# Grupo de seguridad: SSH solo desde mi IP; HTTP/HTTPS públicos. Postgres y NATS nunca se exponen.
SG="$(aws ec2 describe-security-groups --filters Name=group-name,Values="$NOMBRE-sg" Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)"
if [ "$SG" = "None" ]; then
  SG="$(aws ec2 create-security-group --group-name "$NOMBRE-sg" --description "Plataforma de eventos: SSH restringido, HTTP y HTTPS" --vpc-id "$VPC" --query GroupId --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG" --ip-permissions \
    "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=$MI_IP/32,Description=SSH-admin}]" \
    "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" > /dev/null
fi

# Instancia: Ubuntu 24.04, Docker + Compose, IMDSv2 obligatorio, disco cifrado de 20 GB
DATOS_INICIO="$(cat <<'EOF'
#!/bin/bash
set -e
curl -fsSL https://get.docker.com | sh
usermod -aG docker ubuntu
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
mkdir -p /opt/plataforma-eventos && chown ubuntu:ubuntu /opt/plataforma-eventos
EOF
)"

INSTANCIA="$(aws ec2 run-instances --image-id "$AMI" --instance-type "$TIPO" --key-name "$CLAVE" \
  --security-group-ids "$SG" \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=20,VolumeType=gp3,Encrypted=true,DeleteOnTermination=true}' \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NOMBRE},{Key=Proyecto,Value=$NOMBRE}]" \
  --user-data "$DATOS_INICIO" --query 'Instances[0].InstanceId' --output text)"
aws ec2 wait instance-running --instance-ids "$INSTANCIA"

# IP elástica para que la dirección no cambie al apagar y encender
ASIGNACION="$(aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NOMBRE}]" --query AllocationId --output text)"
aws ec2 associate-address --instance-id "$INSTANCIA" --allocation-id "$ASIGNACION" > /dev/null
IP="$(aws ec2 describe-addresses --allocation-ids "$ASIGNACION" --query 'Addresses[0].PublicIp' --output text)"

echo "Instancia: $INSTANCIA ($TIPO)"
echo "IP:        $IP"
echo "Dominio:   ${IP//./-}.sslip.io"
echo "SSH:       ssh -i $ARCHIVO_CLAVE ubuntu@$IP"
