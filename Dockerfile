FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache sqlite3 make g++ python3

RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
