#!/usr/bin/env bash
# Despliega el commit actual en el EC2: copia el código por el túnel SSH y reconstruye los contenedores.
# Uso: bash infra/deploy/desplegar.sh   (requiere el alias "eventos-ec2" en ~/.ssh/config, ver docs/operacion.md)
set -euo pipefail
HOST="${HOST:-eventos-ec2}"
DIR=/opt/plataforma-eventos
DOMINIO="${DOMINIO:-34-230-232-119.sslip.io}"

git archive HEAD | ssh "$HOST" "tar -x -C $DIR"
# El .env del servidor se crea una sola vez y nunca sale de ahí
ssh "$HOST" "cd $DIR && { test -f .env || docker run --rm --user \"\$(id -u):\$(id -g)\" -v \"\$PWD\":/w -w /w node:22-alpine node scripts/generar-env.mjs --domain $DOMINIO; } && docker compose up -d --build --remove-orphans && docker compose ps --format 'table {{.Service}}\t{{.Status}}'"
echo "Listo: https://$DOMINIO"
