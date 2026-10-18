FROM node:22.21.1-alpine AS binary
ARG TARGETARCH
ARG BINARY
ARG BINARY_URL
ARG WISEEFF_BUILD_TLS_POLICY=verify
ARG WISEEFF_BUILD_TLS_ACK
ARG WISEEFF_BUILD_TRANSPORT_FINGERPRINT=unmanaged-verified
RUN --mount=type=bind,source=ops/self-hosted/images,target=/bundle \
    --mount=type=secret,id=wiseeff-corporate-ca \
    test "$TARGETARCH" = amd64 \
    && test -n "$WISEEFF_BUILD_TRANSPORT_FINGERPRINT" \
    && node /bundle/minio/prepare.cjs

FROM node:22.21.1-alpine AS minio
COPY --from=binary /usr/bin/minio /usr/bin/minio
COPY ops/self-hosted/images/minio/entrypoint.sh /usr/bin/docker-entrypoint.sh
USER 0
WORKDIR /
EXPOSE 9000
VOLUME ["/data"]
ENTRYPOINT ["/bin/sh", "/usr/bin/docker-entrypoint.sh"]
CMD ["minio"]

FROM node:22.21.1-alpine AS mc
COPY --from=binary /usr/bin/mc /usr/bin/mc
USER 0
WORKDIR /
ENTRYPOINT ["/usr/bin/mc"]
