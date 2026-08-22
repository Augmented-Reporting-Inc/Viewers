# syntax=docker/dockerfile:1.7-labs
#
# AR / EchoAR OHIF Viewer Dockerfile
# ----------------------------------
#
# Purpose:
#   Builds the customized OHIF static viewer bundle and packages it behind
#   nginx-unprivileged for deployment as the AR echo viewer.
#
# Typical image:
#   804220655312.dkr.ecr.ca-central-1.amazonaws.com/s3orth:ohifar311-4-echo
#
# Typical route:
#   /rviewer/
#
# Build context:
#   Run docker build from the OHIF/Viewers repository root.
#
# BuildKit:
#   This Dockerfile uses Dockerfile 1.7-labs features, including:
#     - COPY --parents
#     - COPY --link
#     - COPY --exclude
#
# Typical build:
#   docker build --no-cache --progress=plain \
#     --build-arg APP_CONFIG=config/default.js \
#     --build-arg PUBLIC_URL=/rviewer/ \
#     --build-arg BUILD_COMMIT="$(git rev-parse --short HEAD)" \
#     --build-arg BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
#     -t 804220655312.dkr.ecr.ca-central-1.amazonaws.com/s3orth:ohifar311-4-echo \
#     .
#
# Stages:
#   1. builder: installs dependencies and builds the static OHIF app.
#   2. final: serves the built static app using nginx-unprivileged.
#
# Notes:
#   - QUICK_BUILD=true is intentionally enabled for faster AR viewer builds.
#   - PUBLIC_URL should match the deployed viewer path, usually /rviewer/.
#   - APP_CONFIG controls the OHIF app config bundled at build time.
#   - This image does not run Node.js at runtime; nginx serves static files only.
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

# Lerna and cross-env are used by the OHIF monorepo build scripts.
RUN npm install -g lerna@7.4.2 cross-env
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

# Copy package manifests first so dependency installation can be cached when
# source code changes but package definitions do not.
COPY package.json yarn.lock preinstall.js lerna.json ./
COPY --parents ./addOns/package.json ./addOns/*/*/package.json ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./

RUN yarn install --production=false

# Copy application source after dependency installation.
COPY --link --exclude=yarn.lock --exclude=package.json --exclude=Dockerfile . .

ENV QUICK_BUILD true
ENV PUBLIC_URL=${PUBLIC_URL}

# Useful build-time visibility. This prints the effective OHIF config path.
RUN yarn run show:config

# Build the production static viewer bundle into platform/app/dist.
RUN yarn run build

# Precompress static assets so nginx can serve .gz/.br variants where configured.
RUN chmod u+x .docker/compressDist.sh
RUN ./.docker/compressDist.sh

FROM nginxinc/nginx-unprivileged:1.27-alpine AS final

ARG BUILD_COMMIT=unknown
ARG BUILD_DATE=unknown
ARG PUBLIC_URL=/
ARG PORT=80

ENV PUBLIC_URL=${PUBLIC_URL}
ENV PORT=${PORT}

LABEL org.opencontainers.image.title="AR OHIF Echo Viewer"
LABEL org.opencontainers.image.description="Static OHIF viewer image for AR deployment"
LABEL org.opencontainers.image.vendor="Augmented Reporting"
LABEL org.opencontainers.image.revision="${BUILD_COMMIT}"
LABEL org.opencontainers.image.created="${BUILD_DATE}"

# Replace the default nginx virtual host with the AR/OHIF nginx template.
RUN rm /etc/nginx/conf.d/default.conf

USER nginx

# Viewer-v3.x contains nginx config and entrypoint used by OHIF static deploys.
COPY --chown=nginx:nginx .docker/Viewer-v3.x /usr/src
RUN chmod 777 /usr/src/entrypoint.sh

# Copy the built static OHIF app from the builder stage.
COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html

# Microscopy libraries depend on root-level includes, so keep this copy even
# for echo builds. Removing it can break shared OHIF runtime assumptions.
COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

# entrypoint.sh may rewrite app-config.js at container start, so ensure nginx
# owns the static output tree.
USER root
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx

ENTRYPOINT ["/usr/src/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
