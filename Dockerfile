# syntax=docker/dockerfile:1.7-labs
#
# AR Unified OHIF Viewer Dockerfile
# ---------------------------------
#
# Build-time public URL:
#   /rviewer/
#
# Runtime internal nginx root:
#   /
#
# AR's outer nginx removes the public viewer prefix before proxying requests
# into this container. Therefore the compiled browser assets use /rviewer/,
# while the internal nginx container serves from /.
#

FROM node:20.18.1-slim AS builder

ARG APP_CONFIG=config/default.js
ARG PUBLIC_URL=/rviewer/
ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown

LABEL org.opencontainers.image.revision="${BUILD_COMMIT}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"

RUN apt-get update && apt-get install -y build-essential python3

RUN mkdir /usr/src/app
WORKDIR /usr/src/app

RUN npm install -g lerna@7.4.2 cross-env
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

COPY package.json yarn.lock preinstall.js lerna.json ./
COPY --parents ./addOns/package.json ./addOns/*/*/package.json ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./

RUN yarn install --production=false

COPY --link --exclude=yarn.lock --exclude=package.json --exclude=Dockerfile . .

ENV QUICK_BUILD=true
ENV PUBLIC_URL=${PUBLIC_URL}

RUN yarn run show:config

RUN yarn run build

RUN chmod u+x .docker/compressDist.sh
RUN ./.docker/compressDist.sh


FROM nginxinc/nginx-unprivileged:1.27-alpine AS final

ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ARG PORT=80

# IMPORTANT:
# The browser bundle was built for /rviewer/, but AR's outer nginx strips
# /rviewer/ before proxying into this container. The internal nginx root
# therefore remains "/".
ENV PUBLIC_URL=/
ENV PORT=${PORT}

LABEL org.opencontainers.image.title="AR Unified OHIF Viewer"
LABEL org.opencontainers.image.description="Unified static OHIF viewer image for AR deployment"
LABEL org.opencontainers.image.vendor="Augmented Reporting"
LABEL org.opencontainers.image.revision="${BUILD_COMMIT}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"

RUN rm /etc/nginx/conf.d/default.conf

USER nginx

COPY --chown=nginx:nginx .docker/Viewer-v3.x /usr/src
RUN chmod 777 /usr/src/entrypoint.sh

COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html

COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

USER root
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx

ENTRYPOINT ["/usr/src/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
