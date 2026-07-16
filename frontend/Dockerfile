# Web microservice: диспетчерская (Vite build → nginx)
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ARG VITE_API_BASE_URL=/api/v1
ARG VITE_WS_BASE_URL=ws://localhost:8080
ARG VITE_YANDEX_MAPS_API_KEY=
ARG VITE_YANDEX_MAPS_SUGGEST_API_KEY=
ARG VITE_ALLOW_DEV_LOGIN=false
ARG VITE_LEGAL_CONTACT_EMAIL=support@invotaxi.kz

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_WS_BASE_URL=$VITE_WS_BASE_URL \
    VITE_YANDEX_MAPS_API_KEY=$VITE_YANDEX_MAPS_API_KEY \
    VITE_YANDEX_MAPS_SUGGEST_API_KEY=$VITE_YANDEX_MAPS_SUGGEST_API_KEY \
    VITE_ALLOW_DEV_LOGIN=$VITE_ALLOW_DEV_LOGIN \
    VITE_LEGAL_CONTACT_EMAIL=$VITE_LEGAL_CONTACT_EMAIL

RUN npm run build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
