# PWA: se compila con Vite y se sirve como estáticos con nginx sin privilegios
FROM node:22-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci --workspace apps/pwa --include-workspace-root=false --no-audit --no-fund && npm run build --workspace apps/pwa

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY apps/pwa/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/pwa/dist /usr/share/nginx/html
EXPOSE 8080
