import { randomUUID } from 'node:crypto';
import { generateText } from '../lib/gemini.js';
import { config } from '../config.js';

const SYSTEM_PROMPT = `Tu es un assistant pédagogique. Tu reçois une liste d'articles de la semaine,
un profil décrivant le niveau et les objectifs d'apprentissage d'un utilisateur,
et un historique des concepts déjà travaillés avec lui.

Ta tâche : générer 5 à 8 questions qui aident à consolider le jargon et les
concepts clés soulevés par ces articles — pas des questions d'actualité
("que s'est-il passé cette semaine"), mais des questions de compréhension
("qu'est-ce que X", "pourquoi Y implique Z", "quelle est la différence entre
A et B").

Règles :
- Priorise les concepts qui reviennent dans plusieurs articles de la semaine
  (signe qu'ils sont structurants) plutôt que des détails isolés.
- Priorise aussi les concepts de l'historique marqués comme mal maîtrisés
  (ratio "pas su" élevé), même s'ils ne reviennent pas explicitement dans
  les articles de cette semaine — la répétition espacée aide à ancrer.
- Ne repose pas une question quasi identique à une déjà posée sur le même
  concept dans les 2-3 dernières semaines (voir l'historique fourni) — varie
  l'angle si tu reviens sur un concept déjà traité.
- Adapte le niveau de difficulté à ce que dit le profil (ex: débutant en
  crypto/DeFi → rester sur les fondamentaux, ne pas sauter aux mécanismes
  avancés sans les avoir posés).
- Chaque question doit avoir une réponse courte (2-4 phrases), en langage
  clair, avec un exemple ou une analogie concrète quand c'est utile pour
  un concept abstrait.
- Varie le format : définitions, "pourquoi c'est important", comparaisons,
  mise en situation. Évite que les 8 questions soient toutes du même moule.
- Ne invente pas de faits qui ne sont pas dans les articles fournis ou dans
  la connaissance générale établie du domaine — reste factuel.
- Associe à chaque question un identifiant de concept clé (concept_cle),
  court et stable (ex: "liquidation_defi", "workload_identity_federation"),
  pour permettre le suivi dans le temps.

Réponds en Markdown avec ce format, question et réponse séparées par une
ligne "---RÉPONSE---" pour permettre de masquer la réponse à l'affichage :

## Question 1 [concept_cle: xxx]
[texte de la question]
---RÉPONSE---
[réponse]

(répéter pour chaque question)`;

function buildUserPrompt(profil, itemsRetenus, conceptsCouverts) {
  return [
    `--- PROFIL UTILISATEUR ---`,
    profil,
    ``,
    `--- ITEMS RETENUS DE LA SEMAINE ---`,
    JSON.stringify(itemsRetenus, null, 2),
    ``,
    `--- HISTORIQUE DES CONCEPTS DÉJÀ TRAVAILLÉS ---`,
    JSON.stringify(conceptsCouverts, null, 2)
  ].join('\n');
}

/**
 * Étape 3 : quiz hebdomadaire. `conceptsCouverts` = extrait de la collection Firestore
 * du même nom (concepts prioritaires à renforcer + déjà posés récemment).
 * Retourne un tableau de questions { id, question, reponse, concept_cle }.
 */
export async function generateQuiz(items, profil, conceptsCouverts) {
  const text = await generateText({
    model: config.models.quiz,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: buildUserPrompt(profil, items, conceptsCouverts)
  });

  return parseQuizMarkdown(text);
}

function parseQuizMarkdown(markdown) {
  const questions = [];
  const blocks = markdown.split(/^## Question \d+/m).slice(1);

  for (const block of blocks) {
    const conceptMatch = block.match(/\[concept_cle:\s*([^\]]+)\]/i);
    const concept_cle = conceptMatch ? conceptMatch[1].trim() : 'inconnu';
    const withoutHeaderTag = block.replace(/\[concept_cle:[^\]]+\]/i, '').trim();
    const [question, reponse] = withoutHeaderTag.split('---RÉPONSE---').map((s) => s.trim());

    if (question && reponse) {
      questions.push({ id: randomUUID(), question, reponse, concept_cle });
    }
  }

  return questions;
}
