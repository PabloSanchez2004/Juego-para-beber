# Build stage
FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build -- --configuration production,docker

# Runtime stage (nginx)
FROM nginx:alpine AS runtime

# Configuración nginx para SPA Angular
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/aproximados/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
