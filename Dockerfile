# Build depuis la racine du repo : gcloud run deploy --source=. (contexte = racine),
# ou docker build -f backend/Dockerfile . depuis la racine.
FROM node:20-slim

WORKDIR /app

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/src ./src
COPY profil-curation-newsletters.md ./profil-curation-newsletters.md

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "src/index.js"]
