# Inkacre in a container. The app has no sign-in, so publish the port only to this computer:
#   docker build -t inkacre .
#   docker run -d --name inkacre -p 127.0.0.1:4141:4141 -v pageyard-data:/data inkacre
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY LICENSE package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY bin ./bin
COPY src ./src
COPY web ./web
RUN mkdir -p /data && chown node:node /data
USER node
ENV LOCAL_WORKSPACE_DATA=/data LOCAL_WORKSPACE_HOST=0.0.0.0 LOCAL_WORKSPACE_PORT=4141
VOLUME ["/data"]
EXPOSE 4141
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4141/api/state').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "bin/cli.mjs", "start", "--no-open"]
