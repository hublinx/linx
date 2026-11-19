FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production DATA_DIR=/app/data
VOLUME ["/app/data"]
CMD ["node", "src/index.mjs"]
