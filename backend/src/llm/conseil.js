import { generateText } from '../lib/gemini.js';
import { config } from '../config.js';

const SYSTEM_PROMPT = `Tu es un assistant qui aide un professionnel à comprendre ce qu'une actualité
change concrètement pour LUI, pas en général.

Tu reçois une liste d'articles déjà jugés pertinents, avec leur catégorie
et une justification de pertinence. Tu reçois aussi le profil de l'utilisateur.

Pour chaque item, rédige un conseil de contextualisation en 2-4 phrases qui répond à :
"Qu'est-ce que ça change concrètement pour mes projets ou mon positionnement actuels ?"

Règles :
- Reste concret et spécifique. Rejette la facilité du "c'est intéressant à suivre".
- Si le lien avec un projet ou objectif précis du profil est réel, nomme-le
  explicitement (ex: "ça rejoint ta piste énergie solaire au Mali parce que...").
- Si le lien est faible, incertain, ou si tu dois forcer la connexion pour
  qu'elle existe, dis-le clairement plutôt que d'inventer une pertinence.
  Un conseil honnête et modeste vaut mieux qu'un conseil créatif mais faux.
- Pour les items "hors radar" avec signal_fort, ne force pas de lien avec
  le profil — explique juste pourquoi c'est un signal fort en soi.
- N'ajoute jamais de recommandation d'achat, de vente, ou de décision
  financière — contextualise, ne prescris pas d'action financière.

Réponds en Markdown, structuré par catégorie, avec pour chaque item :
titre, source, score, puis le conseil.

Précède chaque conseil individuel de la ligne exacte "id: <id de l'item>"
pour permettre de réassocier le texte à l'item correspondant côté code.`;

function buildUserPrompt(profil, itemsRetenus) {
  return `--- PROFIL UTILISATEUR ---\n${profil}\n\n--- ITEMS RETENUS ---\n${JSON.stringify(itemsRetenus, null, 2)}`;
}

/**
 * Étape 2 : conseil/contextualisation. Retourne une map id -> texte du conseil.
 */
export async function generateConseils(items, profil) {
  if (items.length === 0) return {};

  const markdown = await generateText({
    model: config.models.conseil,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(profil, items)
  });

  return parseConseilsById(markdown, items);
}

function parseConseilsById(markdown, items) {
  const conseils = {};
  const blocks = markdown.split(/^id:\s*/m).slice(1);

  for (const block of blocks) {
    const [idLine, ...rest] = block.split('\n');
    const id = idLine.trim();
    if (items.some((item) => item.id === id)) {
      conseils[id] = rest.join('\n').trim();
    }
  }

  return conseils;
}
