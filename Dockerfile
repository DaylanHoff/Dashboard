FROM node:20-alpine

# Install ping for network checks
RUN apk add --no-cache iputils

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 1337

CMD ["node", "server.js"]
