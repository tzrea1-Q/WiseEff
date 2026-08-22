FROM node:22.21.1-alpine AS build-transport

ARG WISEEFF_BUILD_TLS_POLICY=verify
ARG WISEEFF_BUILD_TLS_ACK
ARG WISEEFF_BUILD_TRANSPORT_FINGERPRINT=unmanaged-verified
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/wiseeff-corporate-ca.pem \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
RUN --mount=type=secret,id=wiseeff-corporate-ca \
  test -n "${WISEEFF_BUILD_TRANSPORT_FINGERPRINT}" \
  && case "${WISEEFF_BUILD_TLS_POLICY}" in \
    verify) test -z "${WISEEFF_BUILD_TLS_ACK}" ;; \
    insecure) test "${WISEEFF_BUILD_TLS_ACK}" = "allow-insecure-build" ;; \
    *) exit 10 ;; \
  esac \
  && cp /run/secrets/wiseeff-corporate-ca /etc/ssl/certs/wiseeff-corporate-ca.pem \
  && if grep -q -- '-----BEGIN CERTIFICATE-----' /etc/ssl/certs/wiseeff-corporate-ca.pem; then \
    cat /etc/ssl/certs/wiseeff-corporate-ca.pem >> /etc/ssl/certs/ca-certificates.crt; \
  fi

FROM build-transport AS dtc-builder

ARG WISEEFF_BUILD_TLS_POLICY
ENV LD_LIBRARY_PATH=/opt/dtc/lib

# Pin device-tree-compiler (dtc + fdtoverlay) to the locked production commit.
ARG DTC_COMMIT=8f48565e5cfedc74d3f7512f1e0188e9d85dc1de
RUN if [ "${WISEEFF_BUILD_TLS_POLICY}" = "insecure" ]; then \
    apk --no-check-certificate add --no-cache build-base bison flex git pkgconf yaml-dev \
      python3 py3-pip python3-dev swig meson samurai py3-meson-python; \
  else \
    apk add --no-cache build-base bison flex git pkgconf yaml-dev \
      python3 py3-pip python3-dev swig meson samurai py3-meson-python; \
  fi
WORKDIR /src
RUN if [ "${WISEEFF_BUILD_TLS_POLICY}" = "insecure" ]; then \
    git -c http.sslVerify=false clone --filter=blob:none https://git.kernel.org/pub/scm/utils/dtc/dtc.git; \
  else \
    git clone --filter=blob:none https://git.kernel.org/pub/scm/utils/dtc/dtc.git; \
  fi \
  && cd dtc \
  && git checkout "${DTC_COMMIT}" \
  && make NO_PYTHON=1 PREFIX=/opt/dtc install \
  && /opt/dtc/bin/dtc --version \
  && /opt/dtc/bin/fdtoverlay --version
RUN cd /src/dtc \
  && pip3 wheel --no-build-isolation --wheel-dir /opt/dtc-wheels .

FROM build-transport AS deps

ARG WISEEFF_BUILD_TLS_POLICY
ARG WISEEFF_BUILD_TLS_ACK
ARG WISEEFF_NPM_REGISTRY

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ ./packages/
COPY ops/self-hosted/scripts/npm-ci-with-diagnostics.sh /usr/local/bin/wiseeff-npm-ci
RUN /usr/local/bin/wiseeff-npm-ci

FROM build-transport AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    LD_LIBRARY_PATH=/opt/dtc/lib
ARG WISEEFF_BUILD_TLS_POLICY
LABEL org.wiseeff.build-tls-policy="${WISEEFF_BUILD_TLS_POLICY}"
ARG VITE_WISEEFF_RUNTIME_MODE=api
ARG VITE_WISEEFF_API_BASE_URL
ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE
ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL
ENV PATH="/opt/dtc/bin:${PATH}"
RUN if [ "${WISEEFF_BUILD_TLS_POLICY}" = "insecure" ]; then \
    apk --no-check-certificate add --no-cache curl python3 py3-pip yaml; \
  else \
    apk add --no-cache curl python3 py3-pip yaml; \
  fi
COPY tools/dts-toolchain/requirements.txt /tmp/dts-toolchain-requirements.txt
COPY tools/dts-toolchain/versions.json /etc/wiseeff-dts-toolchain-versions.json
COPY --from=dtc-builder /opt/dtc /opt/dtc
COPY --from=dtc-builder /opt/dtc-wheels /tmp/dtc-wheels
RUN if [ "${WISEEFF_BUILD_TLS_POLICY}" = "insecure" ]; then \
    set -- --trusted-host pypi.org --trusted-host files.pythonhosted.org; \
  else \
    set --; \
  fi \
  && pip3 install "$@" --break-system-packages --no-cache-dir /tmp/dtc-wheels/libfdt-*.whl \
  && pip3 install "$@" --break-system-packages --no-cache-dir \
    "ruamel.yaml>0.15.69" "jsonschema>=4.18" rfc3987 \
  && pip3 install "$@" --break-system-packages --no-cache-dir --no-deps -r /tmp/dts-toolchain-requirements.txt \
  && rm -rf /tmp/dtc-wheels
RUN dtc --version && fdtoverlay --version && dt-validate --version \
  && echo "Pinned toolchain:" && cat /etc/wiseeff-dts-toolchain-versions.json
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NODE_OPTIONS='--max-old-space-size=2048' npx tsc -b && NODE_OPTIONS='--max-old-space-size=2048' npx vite build

CMD ["npx", "tsx", "server/index.ts"]
