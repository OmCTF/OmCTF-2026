FROM node:22-bookworm AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm test && npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/kazna.conf.in
COPY start-viewer.sh /usr/local/bin/start-viewer
ENV JURY_UPSTREAM=http://skipper:8080 ARENA_TASK=treasury
EXPOSE 80
CMD ["/bin/sh", "/usr/local/bin/start-viewer"]
