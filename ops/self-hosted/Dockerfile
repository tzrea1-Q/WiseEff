FROM node:22.21.1-alpine AS dtc-builder

# Pin device-tree-compiler (dtc + fdtoverlay) to the locked production commit.
ARG DTC_COMMIT=8f48565e5cfedc74d3f7512f1e0188e9d85dc1de
RUN apk add --no-cache build-base bison flex git
WORKDIR /src
RUN git clone --filter=blob:none https://git.kernel.org/pub/scm/utils/dtc/dtc.git \
  && cd dtc \
  && git checkout "${DTC_COMMIT}" \
  && make NO_PYTHON=1 PREFIX=/opt/dtc install \
  && /opt/dtc/bin/dtc --version \
  && /opt/dtc/bin/fdtoverlay --version

FROM node:22.21.1-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/ ./packages/
RUN npm ci

FROM node:22.21.1-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ARG VITE_WISEEFF_RUNTIME_MODE=api
ARG VITE_WISEEFF_API_BASE_URL
ENV VITE_WISEEFF_RUNTIME_MODE=$VITE_WISEEFF_RUNTIME_MODE
ENV VITE_WISEEFF_API_BASE_URL=$VITE_WISEEFF_API_BASE_URL
ENV PATH="/opt/dtc/bin:${PATH}"
RUN apk add --no-cache curl python3 py3-pip
COPY tools/dts-toolchain/requirements.txt /tmp/dts-toolchain-requirements.txt
COPY tools/dts-toolchain/versions.json /etc/wiseeff-dts-toolchain-versions.json
RUN pip3 install --break-system-packages --no-cache-dir -r /tmp/dts-toolchain-requirements.txt
COPY --from=dtc-builder /opt/dtc /opt/dtc
RUN dtc --version && fdtoverlay --version && dt-validate --version \
  && echo "Pinned toolchain:" && cat /etc/wiseeff-dts-toolchain-versions.json
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NODE_OPTIONS='--max-old-space-size=2048' npx tsc -b && NODE_OPTIONS='--max-old-space-size=2048' npx vite build

CMD ["npx", "tsx", "server/index.ts"]
