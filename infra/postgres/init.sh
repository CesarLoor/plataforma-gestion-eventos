#!/bin/sh
# Una base de datos y un usuario por servicio; cada usuario solo puede entrar a la suya (mínimo privilegio)
set -eu
for s in auth catalog inventory orders tickets checkin notifications reports; do
  var="DB_PASS_$(echo "$s" | tr '[:lower:]' '[:upper:]')"
  pass=$(printenv "$var")
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -v usuario="$s" -v clave="$pass" <<'SQL'
CREATE ROLE :"usuario" LOGIN PASSWORD :'clave';
CREATE DATABASE :"usuario" OWNER :"usuario";
REVOKE ALL ON DATABASE :"usuario" FROM PUBLIC;
SQL
done
