FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data EXIT_ON_CONFIG_ERROR=false TZ=Asia/Ho_Chi_Minh
RUN apk add --no-cache tzdata
COPY package.json ./
COPY src ./src
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
USER node
CMD ["node", "src/index.mjs"]
