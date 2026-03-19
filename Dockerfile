FROM node:18-bullseye

WORKDIR /app

COPY package*.json ./

RUN apt-get update && apt-get install -y sqlite3 build-essential python3 curl

RUN npm install --production

COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 CMD curl -f http://localhost:3000/ || exit 1

EXPOSE 3000

CMD ["node", "server.js"]
