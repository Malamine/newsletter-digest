import { randomUUID } from 'node:crypto';
import { generateText, extractJson } from '../lib/gemini.js';
import { mapWithConcurrency } from '../lib/concurrency.js';
import { config } from '../config.js';

const MAX_ITEMS_PER_CATEGORY = 5;
// Batchs traités en parallèle — au-delà, risque de multiplier les 429 (quota RPM du free tier
// Gemini) plus vite qu'on ne gagne en temps total, même avec le retry/backoff en place.
const BATCH_CONCURRENCY = 3;

// --- Passe 1 : tri rapide sur titre/sujet, sortie minimale (pas de résumé/justification détaillée) ---
const QUICK_FILTER_PROMPT = `Tu es un assistant de tri rapide. Tu reçois un lot d'articles et de
newsletters de la semaine, ainsi qu'un profil décrivant les centres d'intérêt
d'un utilisateur.

Ta tâche : repérer chaque item (article) présent dans le contenu et juger
RAPIDEMENT s'il mérite une lecture complète — base ton jugement principalement
sur le TITRE et le sujet général, pas sur une analyse approfondie du texte.

Règles :
- Sois large à ce stade : en cas de doute, marque "pertinent": true. Le tri
  fin (score précis, élimination sévère) se fait à l'étape suivante, sur les
  seuls items que tu retiens ici. Le but ici est seulement d'éliminer
  d'emblée ce qui est manifestement hors-sujet : publicité, listicle
  générique, sujet totalement étranger au profil et sans caractère de
  rupture majeure.
- "signal_fort_probable": true si le titre suggère un événement de rupture ou
  d'impact large, indépendamment du profil (à confirmer à l'étape suivante).
- Ne fusionne pas plusieurs items.

Réponds UNIQUEMENT en JSON, sans texte avant ou après :

{
  "items": [
    { "titre": "...", "source": "...", "email_id": "...", "pertinent": true/false, "signal_fort_probable": true/false }
  ]
}`;

// --- Passe 2 : lecture complète, uniquement sur les items retenus par la passe 1 ---
const FULL_CURATION_PROMPT = `Tu es un assistant de curation d'information. Tu reçois un lot d'articles
et de newsletters de la semaine, un profil décrivant les centres d'intérêt
d'un utilisateur, et une liste de titres déjà présélectionnés.

Tu ne dois traiter QUE les items dont le titre figure dans la liste
"TITRES À TRAITER" fournie plus bas — ignore tous les autres items présents
dans le contenu source, même s'ils semblent intéressants.

Pour chaque item à traiter, attribue :
- un score de pertinence de 0 à 10 par rapport au profil fourni
- la catégorie du profil concernée (ou "hors_radar" si aucune ne correspond)
- un résumé factuel de 1 à 2 phrases courtes reprenant les points clés de l'article
  (les faits, chiffres, mécanismes concrets qu'il aborde — PAS une justification
  de pertinence, un vrai résumé de ce que dit l'article, utilisable seul sans
  avoir à cliquer dessus)
- une justification de pertinence en une phrase, factuelle, sans enjolivement
  (distincte du résumé : ici tu expliques pourquoi ce score/cette catégorie,
  pas ce que dit l'article)
- l'identifiant de l'email source (email_id, voir balises ### Email ci-dessous)

Règles :
- Ne fusionne pas plusieurs items en un seul score : chaque item est évalué
  indépendamment.
- Un item "hors_radar" (score de pertinence au profil bas) peut quand même
  recevoir le flag "signal_fort": true s'il s'agit d'une rupture ou d'un
  événement manifestement important indépendamment du profil (impact large,
  large couverture, changement structurel). Ne pas déclencher ce flag pour
  du contenu simplement viral ou commercial.
- Sois sévère sur le score : un article "pas inintéressant" n'est pas un
  article pertinent. Le score 7+ doit rester rare — réserve-le aux articles
  vraiment structurants, pas à tout ce qui touche au sujet en général.

Réponds UNIQUEMENT en JSON, sans texte avant ou après, avec cette structure :

{
  "items": [
    {
      "id": "...",
      "titre": "...",
      "source": "...",
      "score_pertinence": 0-10,
      "categorie": "reposition_ai_infra | crypto_defi | mali_diaspora | portage_pme | infogerance_mlops_finops | hors_radar",
      "signal_fort": true/false,
      "resume": "...",
      "justification": "...",
      "email_id": "..."
    }
  ]
}`;

function buildQuickFilterPrompt(profil, contenuBrut) {
  return `--- PROFIL UTILISATEUR ---\n${profil}\n\n--- CONTENU DE LA SEMAINE ---\n${contenuBrut}`;
}

function buildFullCurationPrompt(profil, contenuBrut, titresRetenus) {
  return `--- PROFIL UTILISATEUR ---\n${profil}\n\n--- TITRES À TRAITER ---\n${titresRetenus.map((t) => `- ${t}`).join('\n')}\n\n--- CONTENU DE LA SEMAINE ---\n${contenuBrut}`;
}

function batchEmails(emails, batchSize = 4) {
  const batches = [];
  for (let i = 0; i < emails.length; i += batchSize) {
    batches.push(emails.slice(i, i + batchSize));
  }
  return batches;
}

function formatBatch(batch) {
  return batch
    .map(
      (email) =>
        `### Email — ${email.titre}\nemail_id : ${email.id}\nSource : ${email.source}\nDate : ${email.date}\n\n${email.contenu}`
    )
    .join('\n\n---\n\n');
}

/**
 * Plafonne le nombre d'items retenus par catégorie (indépendant de la calibration du LLM sur les
 * scores). Priorise signal_fort, puis score_pertinence décroissant.
 */
function capPerCategory(items, max = MAX_ITEMS_PER_CATEGORY) {
  const sorted = [...items].sort((a, b) => {
    if (a.signal_fort !== b.signal_fort) return a.signal_fort ? -1 : 1;
    return b.score_pertinence - a.score_pertinence;
  });

  const countByCategory = new Map();
  const kept = [];
  for (const item of sorted) {
    const count = countByCategory.get(item.categorie) || 0;
    if (count >= max) continue;
    countByCategory.set(item.categorie, count + 1);
    kept.push(item);
  }
  return kept;
}

/**
 * Étape 1 : curation/scoring, en deux passes par batch d'emails.
 * Passe 1 (tri rapide) : juge sur titre/sujet, sortie minimale — élimine le hors-sujet évident
 * sans dépenser de tokens de sortie sur un résumé/justification inutiles.
 * Passe 2 (lecture complète) : score + résumé + justification, uniquement sur les items retenus.
 * `emails` = sortie de gmail.fetchNewsletterEmails().
 * Retourne les items filtrés (score_pertinence >= 6 OU signal_fort), plafonnés à
 * MAX_ITEMS_PER_CATEGORY par catégorie, avec un id Firestore stable.
 */
async function processBatch(batch, index, total, profil) {
  const knownEmailIds = new Set(batch.map((e) => e.id));
  const batchContent = formatBatch(batch);
  const label = `Batch ${index + 1}/${total}`;

  console.log(`[curation] ${label} — tri rapide par titre...`);
  let candidates;
  try {
    const text = await generateText({
      model: config.models.curation,
      systemPrompt: QUICK_FILTER_PROMPT,
      userPrompt: buildQuickFilterPrompt(profil, batchContent),
      maxOutputTokens: 16384,
      thinkingBudget: 0
    });
    candidates = extractJson(text).items || [];
  } catch (err) {
    console.warn(`[curation] ${label} — tri rapide échoué :`, err.message);
    return [];
  }

  const retenus = candidates.filter((c) => c.pertinent || c.signal_fort_probable);
  console.log(`[curation] ${label} — ${retenus.length}/${candidates.length} titre(s) retenu(s) pour lecture complète`);

  if (retenus.length === 0) return [];

  let parsed;
  try {
    const text = await generateText({
      model: config.models.curation,
      systemPrompt: FULL_CURATION_PROMPT,
      userPrompt: buildFullCurationPrompt(profil, batchContent, retenus.map((r) => r.titre)),
      maxOutputTokens: 32768,
      thinkingBudget: 0
    });
    parsed = extractJson(text);
  } catch (err) {
    console.warn(`[curation] ${label} — lecture complète échouée :`, err.message);
    return [];
  }

  const items = (parsed.items || []).map((item) => {
    const emailId = knownEmailIds.has(item.email_id) ? item.email_id : null;
    return {
      ...item,
      id: randomUUID(),
      url_newsletter: emailId ? `https://mail.google.com/mail/u/0/#all/${emailId}` : null
    };
  });
  console.log(`[curation] ${label} OK — ${items.length} item(s) traités`);
  return items;
}

export async function curateItems(emails, profil) {
  const batches = batchEmails(emails);

  const results = await mapWithConcurrency(batches, BATCH_CONCURRENCY, (batch, index) =>
    processBatch(batch, index, batches.length, profil)
  );
  const allItems = results.flat();

  const filtered = allItems.filter((item) => item.score_pertinence >= 6 || item.signal_fort === true);
  const capped = capPerCategory(filtered);
  console.log(
    `[curation] ${filtered.length} item(s) après filtre score, ${capped.length} après plafond ${MAX_ITEMS_PER_CATEGORY}/catégorie`
  );
  return capped;
}
