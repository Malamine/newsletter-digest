# Newsletter Digest

Webapp personnelle qui digère les newsletters hebdomadaires (label Gmail `NEWSLETTER`), filtre le bruit via un pipeline Gemini en 3 étapes, et produit chaque semaine un digest + un quiz de renforcement. Usage mono-utilisateur.

Pour l'historique complet des décisions de cadrage, voir [`CLAUDE.md`](./CLAUDE.md).

> Ce README documente le fonctionnement général du projet, avec des placeholders (`$GCP_PROJECT_ID`, etc.) à la place des valeurs réelles de mon déploiement — je garde ces valeurs dans des notes privées, pas dans le repo public. Si tu déploies ta propre instance, remplace-les par les tiennes.

## Architecture en un coup d'œil

```
Front statique (GitHub Pages, branche gh-pages)
      │  fetch()
      ▼
Backend Cloud Run — Service (API, branche main → backend/)
      │  GET/POST /digest, /quiz, /items, /push
      │
      ├── Firestore (items, digests, quiz, réponses, concepts)
      └── Web Push (notifications)

Cloud Run — Jobs (batch, même image, entrypoint différent)
      ├── newsletter-generate-digest  (Gmail + Gemini + Firestore + push)
      └── newsletter-daily-relance    (Firestore + push)

Cloud Scheduler → déclenche les Jobs via l'API Run (IAM, pas de secret HTTP)
```

Le pipeline (`/cron/generate-digest`, `/cron/relance`) tournait au départ comme des routes HTTP sur le Service, mais un run peut prendre 5-12 min (plusieurs appels Gemini séquentiels) — ça se heurtait au timeout HTTP et forçait à le repousser artificiellement. Passé en **Cloud Run Jobs** : pas de plafond de timeout HTTP (jusqu'à 24h), sémantique batch plus naturelle, et Cloud Scheduler les déclenche via l'API Cloud Run avec un jeton OAuth du compte de service — plus besoin d'un secret partagé (`CRON_SECRET` a été supprimé).

## Secrets

**Toute clé va dans Google Secret Manager, jamais commitée.** Le `.env` local (voir `backend/.env.example`) est la seule exception, et il est gitignoré.

| Variable d'env backend | Usage | Comment l'obtenir |
|---|---|---|
| `GEMINI_API_KEY` | Appels Gemini | Clé sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | OAuth Gmail | Console GCP → APIs & Services → Identifiants (client "Application de bureau") |
| `GMAIL_REFRESH_TOKEN` | Accès lecture Gmail | `npm run gmail:auth` depuis `backend/` (voir plus bas) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push | `npm run vapid:generate` depuis `backend/` |
| `VAPID_CONTACT_EMAIL` | Requis par le protocole Web Push (contact en cas d'abus) | Ton adresse, au format `mailto:...` — pas un secret à proprement parler mais pas de valeur par défaut dans le code |

**Piège vécu** : `openssl rand -hex 32` ajoute un `\n` en fin de sortie. Piper ça tel quel dans `gcloud secrets versions add` stocke ce `\n` dans le secret, qui ne matchera alors jamais une valeur récupérée via `$(...)` (qui strip les `\n`). Toujours utiliser `printf '%s' "$(openssl rand -hex 32)" | gcloud secrets versions add ...`.

**Rotation d'un secret** :
```bash
printf '%s' "<nouvelle_valeur>" | gcloud secrets versions add <NOM_SECRET> --data-file=- --project=$GCP_PROJECT_ID --format=none
```
Puis **redéployer** (voir plus bas) — Cloud Run résout `:latest` au démarrage d'une instance, pas en continu ; une instance déjà chaude garde l'ancienne valeur en mémoire tant qu'elle n'est pas recyclée.

Le service Cloud Run tourne avec un compte de service **dédié**, distinct du compte par défaut du projet (qui a `roles/editor` sur tout le projet — bien trop large). Ce compte dédié n'a que :
- `secretmanager.secretAccessor` sur chacun des secrets ci-dessus, individuellement (pas de rôle Secret Manager au niveau projet)
- `roles/datastore.user` (Firestore uniquement)

```bash
gcloud iam service-accounts create newsletter-backend --project=$GCP_PROJECT_ID
for SECRET in GEMINI_API_KEY GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=$GCP_PROJECT_ID \
    --member="serviceAccount:newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"

# Autoriser ce même compte à déclencher les 2 Jobs (pour Cloud Scheduler)
for JOB in newsletter-generate-digest newsletter-daily-relance; do
  gcloud run jobs add-iam-policy-binding "$JOB" --project=$GCP_PROJECT_ID --region=$GCP_REGION \
    --member="serviceAccount:newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.invoker"
done
```

## Développement local

```bash
cd backend
npm install
cp .env.example .env   # puis remplir avec tes propres valeurs
npm run dev
```

Front : `cd frontend && python3 -m http.server 8420` (ou n'importe quel serveur statique).

## Déploiement backend

```bash
cd /path/to/repo   # racine du repo — le Dockerfile copie backend/ + profil-curation-newsletters.md
gcloud run deploy newsletter-digest-backend \
  --source=. \
  --project=$GCP_PROJECT_ID \
  --region=$GCP_REGION \
  --allow-unauthenticated \
  --service-account=newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --min-instances=0 --max-instances=1 --cpu=1 --memory=256Mi --timeout=60 \
  --set-env-vars=GCP_PROJECT_ID=$GCP_PROJECT_ID,GMAIL_LABEL=NEWSLETTER,VAPID_CONTACT_EMAIL=mailto:you@example.com \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest,GMAIL_CLIENT_ID=GMAIL_CLIENT_ID:latest,GMAIL_CLIENT_SECRET=GMAIL_CLIENT_SECRET:latest,GMAIL_REFRESH_TOKEN=GMAIL_REFRESH_TOKEN:latest,VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest
```

Ce Service n'expose plus que l'API (digest/quiz/items/push) — pas de traitement long, donc le timeout par défaut (60s) suffit. La commande affiche l'URL du service déployé à la fin — c'est cette URL qu'il faut mettre dans `BACKEND_URL` côté front (`frontend/app.js`).

### Jobs (pipeline)

```bash
gcloud run jobs deploy newsletter-generate-digest \
  --source=. --project=$GCP_PROJECT_ID --region=$GCP_REGION \
  --service-account=newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --command=node --args=src/jobs/generate-digest.js \
  --max-retries=0 --task-timeout=1800s --cpu=1 --memory=512Mi \
  --set-env-vars=GCP_PROJECT_ID=$GCP_PROJECT_ID,GMAIL_LABEL=NEWSLETTER,VAPID_CONTACT_EMAIL=mailto:you@example.com \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest,GMAIL_CLIENT_ID=GMAIL_CLIENT_ID:latest,GMAIL_CLIENT_SECRET=GMAIL_CLIENT_SECRET:latest,GMAIL_REFRESH_TOKEN=GMAIL_REFRESH_TOKEN:latest,VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest

gcloud run jobs deploy newsletter-daily-relance \
  --source=. --project=$GCP_PROJECT_ID --region=$GCP_REGION \
  --service-account=newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com \
  --command=node --args=src/jobs/daily-relance.js \
  --max-retries=0 --task-timeout=300s --cpu=1 --memory=512Mi \
  --set-env-vars=GCP_PROJECT_ID=$GCP_PROJECT_ID,VAPID_CONTACT_EMAIL=mailto:you@example.com \
  --set-secrets=VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest
```

Jobs Cloud Run : minimum 512Mi de mémoire imposé (gen2, CPU toujours alloué) — 256Mi suffit pour le Service mais est refusé pour un Job.

> Note : cette URL de service, une fois le front déployé, est visible en clair dans le JS chargé par n'importe quel navigateur (`fetch(BACKEND_URL)`) — ce n'est pas un secret, contrairement au project ID / service account qui n'ont eux aucune raison de fuiter et n'ont donc pas leur place dans un repo public.

## Déploiement front

Le front est servi depuis la branche `gh-pages` (contenu de `frontend/` à la racine de cette branche, pas de sous-dossier — c'est une contrainte de GitHub Pages en mode "classic").

```bash
git checkout gh-pages
git checkout main -- frontend
cp -r frontend/* .
rm -rf frontend backend   # ne garder que les fichiers front à la racine de gh-pages
git add index.html manifest.json app.js styles.css sw.js icon-*.png
git commit -m "Deploy frontend"
git push origin gh-pages
git checkout main
```

**À chaque changement de `frontend/`**, penser à bumper `CACHE_NAME` dans `frontend/sw.js` (`digest-cache-vN` → `vN+1`) — sinon le service worker continue de servir l'ancienne version en cache aux visiteurs.

## Déclencher un run manuellement

```bash
gcloud run jobs execute newsletter-generate-digest --project=$GCP_PROJECT_ID --region=$GCP_REGION --wait
gcloud run jobs execute newsletter-daily-relance --project=$GCP_PROJECT_ID --region=$GCP_REGION --wait
```

Logs d'une exécution : `gcloud run jobs executions list --job=newsletter-generate-digest --region=$GCP_REGION`, puis `gcloud beta run jobs executions logs read <execution-id> --region=$GCP_REGION`.

## Cloud Scheduler

Deux jobs, qui déclenchent les Cloud Run Jobs via l'API Run (pas de HTTP direct sur le Service) :

```bash
gcloud scheduler jobs create http newsletter-weekly-digest \
  --project=$GCP_PROJECT_ID --location=$GCP_REGION \
  --schedule="0 7 * * 1" --time-zone="Europe/Paris" \
  --uri="https://$GCP_REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$GCP_PROJECT_ID/jobs/newsletter-generate-digest:run" \
  --http-method=POST \
  --oauth-service-account-email=newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com

gcloud scheduler jobs create http newsletter-daily-relance \
  --project=$GCP_PROJECT_ID --location=$GCP_REGION \
  --schedule="0 8 * * *" --time-zone="Europe/Paris" \
  --uri="https://$GCP_REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$GCP_PROJECT_ID/jobs/newsletter-daily-relance:run" \
  --http-method=POST \
  --oauth-service-account-email=newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com
```

Le compte de service utilisé ici doit avoir `roles/run.invoker` sur chaque Job (voir section Secrets ci-dessus). Pas de secret à faire tourner pour cette partie — l'auth passe entièrement par IAM.

## Limites connues

- Pas d'historique consultable dans l'app (seule la semaine courante est affichée ; les semaines passées restent en Firestore mais sans endpoint pour les lister).
- Le lien "Lire la newsletter" pointe vers l'email Gmail source, pas vers l'article externe précis (un email peut contenir plusieurs articles).
- Voir aussi la section sécurité dans `CLAUDE.md` pour les compromis assumés (scope Gmail, boîte perso vs dédiée).
