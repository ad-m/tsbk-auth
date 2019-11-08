FROM node:12-alpine

WORKDIR /src
COPY package* ./
ENV NODE_ENV=production
RUN npm ci
COPY . .
EXPOSE 8080
CMD ["node","index.js"]