FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y sqlite3 build-essential python3

RUN npm install --production

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
