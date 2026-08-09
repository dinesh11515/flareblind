FROM node:22-alpine

WORKDIR /app

COPY engine/package.json engine/package-lock.json ./
RUN npm ci

COPY engine/tsconfig.json ./
COPY engine/src ./src

ENV NODE_ENV=production

CMD ["npm", "start"]
