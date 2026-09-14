# Newsletter Digest

Webapp personnelle qui digère les newsletters hebdomadaires (label Gmail `NEWSLETTER`), filtre le bruit via un pipeline Gemini en 3 étapes, et produit chaque semaine un digest + un quiz de renforcement. Usage mono-utilisateur.

Pour l'historique complet des décisions de cadrage, voir [`CLAUDE.md`](./CLAUDE.md).

> Ce README documente le fonctionnement général du projet, avec des placeholders (`$GCP_PROJECT_ID`, etc.) à la place des valeurs réelles de mon déploiement — je garde ces valeurs dans des notes privées, pas dans le repo public. Si tu déploies ta propre instance, remplace-les par les tiennes.

## Architecture en un coup d'œil

```
Front statique (GitHub Pages, branche gh-pages)
      │  fetch()
      ▼
Backend Cloud Run (Node/Express, branche main → backend/)
      │
      ├── Gmail API (lecture d'un label donné, ex: NEWSLETTER)
      ├── Gemini API (curation / conseil / quiz)
      ├── Firestore (items, digests, quiz, réponses, concepts)
      └── Web Push (notifications)

Cloud Scheduler → POST /cron/generate-digest (hebdo)
                → POST /cron/relance (quotidien)
```

## Secrets

**Toute clé va dans Google Secret Manager, jamais commitée.** Le `.env` local (voir `backend/.env.example`) est la seule exception, et il est gitignoré.

| Variable d'env backend | Usage | Comment l'obtenir |
|---|---|---|
| `GEMINI_API_KEY` | Appels Gemini | Clé sur [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | OAuth Gmail | Console GCP → APIs & Services → Identifiants (client "Application de bureau") |
| `GMAIL_REFRESH_TOKEN` | Accès lecture Gmail | `npm run gmail:auth` depuis `backend/` (voir plus bas) |
| `CRON_SECRET` | Protège `/cron/*` | `openssl rand -hex 32` (sans retour à la ligne, voir note ci-dessous) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push | `npm run vapid:generate` depuis `backend/` |

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
for SECRET in GEMINI_API_KEY GMAIL_CLIENT_ID GMAIL_CLIENT_SECRET GMAIL_REFRESH_TOKEN CRON_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
  gcloud secrets add-iam-policy-binding "$SECRET" --project=$GCP_PROJECT_ID \
    --member="serviceAccount:newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:newsletter-backend@$GCP_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
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
  --min-instances=0 --max-instances=1 --cpu=1 --memory=256Mi --timeout=900 \
  --set-env-vars=GCP_PROJECT_ID=$GCP_PROJECT_ID,GMAIL_LABEL=NEWSLETTER \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest,GMAIL_CLIENT_ID=GMAIL_CLIENT_ID:latest,GMAIL_CLIENT_SECRET=GMAIL_CLIENT_SECRET:latest,GMAIL_REFRESH_TOKEN=GMAIL_REFRESH_TOKEN:latest,CRON_SECRET=CRON_SECRET:latest,VAPID_PUBLIC_KEY=VAPID_PUBLIC_KEY:latest,VAPID_PRIVATE_KEY=VAPID_PRIVATE_KEY:latest
```

`--timeout=900` est nécessaire : le run hebdo peut prendre 5-12 min (plusieurs appels Gemini séquentiels). La commande affiche l'URL du service déployé à la fin — c'est cette URL qu'il faut mettre dans `BACKEND_URL` côté front (`frontend/app.js`).

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
CRON_SECRET=$(gcloud secrets versions access latest --secret=CRON_SECRET --project=$GCP_PROJECT_ID)
curl -X POST -H "X-Cron-Secret: $CRON_SECRET" "$BACKEND_URL/cron/generate-digest"
unset CRON_SECRET
```

## Cloud Scheduler

Deux jobs :
- run hebdo → `/cron/generate-digest`
- relance quotidienne → `/cron/relance`

Si `CRON_SECRET` est régénéré, mettre à jour les deux jobs :
```bash
NEW=$(gcloud secrets versions access latest --secret=CRON_SECRET --project=$GCP_PROJECT_ID)
gcloud scheduler jobs update http <job-hebdo> --location=$GCP_REGION --update-headers="X-Cron-Secret=$NEW" --format=none
gcloud scheduler jobs update http <job-quotidien> --location=$GCP_REGION --update-headers="X-Cron-Secret=$NEW" --format=none
```

## Limites connues

- Pas d'historique consultable dans l'app (seule la semaine courante est affichée ; les semaines passées restent en Firestore mais sans endpoint pour les lister).
- Le lien "Lire la newsletter" pointe vers l'email Gmail source, pas vers l'article externe précis (un email peut contenir plusieurs articles).
- Voir aussi la section sécurité dans `CLAUDE.md` pour les compromis assumés (scope Gmail, boîte perso vs dédiée).
