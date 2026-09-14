import { db, isoWeek, previousWeeks } from './lib/firestore.js';
import { loadProfile } from './lib/profile.js';
import { fetchNewsletterEmails } from './gmail.js';
import { curateItems } from './llm/curation.js';
import { generateConseils } from './llm/conseil.js';
import { generateQuiz } from './llm/quiz.js';
import { sendPushToAll } from './lib/push.js';

// Étape 0 — items forts non consultés des semaines précédentes, réinjectés en tête du digest.
async function findItemsARelancer(currentWeek) {
  const candidateWeeks = previousWeeks(2, new Date());
  const found = [];

  for (const week of candidateWeeks) {
    const snapshot = await db
      .collection('items')
      .where('date_semaine', '==', week)
      .where('consulte', '==', false)
      .get();

    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.signal_fort === true || data.score_pertinence >= 8) {
        found.push({ id: doc.id, ...data });
      }
    });
  }

  return found;
}

async function getConceptsPourRenforcement() {
  const snapshot = await db.collection('concepts_couverts').orderBy('nb_fois_pas_su', 'desc').limit(20).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function runWeeklyPipeline() {
  const semaine = isoWeek(new Date());
  console.log(`[pipeline] Démarrage run hebdo — semaine ${semaine}`);

  const profil = await loadProfile();

  const itemsRelances = await findItemsARelancer(semaine);
  console.log(`[pipeline] ${itemsRelances.length} item(s) à relancer des semaines précédentes`);

  const emails = await fetchNewsletterEmails(7);
  console.log(`[pipeline] ${emails.length} email(s) ingérés depuis Gmail`);

  const itemsRetenus = await curateItems(emails, profil);
  console.log(`[pipeline] Étape 1 (curation) terminée — ${itemsRetenus.length} item(s) retenu(s)`);

  const conseils = await generateConseils(itemsRetenus, profil);
  console.log(`[pipeline] Étape 2 (conseil) terminée — ${Object.keys(conseils).length} conseil(s) généré(s)`);

  const conceptsCouverts = await getConceptsPourRenforcement();
  const questions = await generateQuiz(itemsRetenus, profil, conceptsCouverts);
  console.log(`[pipeline] Étape 3 (quiz) terminée — ${questions.length} question(s) générée(s)`);

  const batch = db.batch();

  for (const item of itemsRetenus) {
    const ref = db.collection('items').doc(item.id);
    batch.set(ref, {
      titre: item.titre,
      source: item.source,
      date_semaine: semaine,
      score_pertinence: item.score_pertinence,
      categorie: item.categorie,
      signal_fort: item.signal_fort,
      resume: item.resume || '',
      justification: item.justification,
      url_newsletter: item.url_newsletter || null,
      conseil: conseils[item.id] || '',
      consulte: false,
      date_consultation: null,
      nb_relances: 0,
      date_derniere_relance: null
    });
  }

  const digestRef = db.collection('digests').doc(semaine);
  batch.set(digestRef, {
    items_ids: itemsRetenus.map((i) => i.id),
    items_relances_ids: itemsRelances.map((i) => i.id),
    statut: 'non_consulte',
    date_generation: new Date().toISOString(),
    date_premiere_consultation: null
  });

  const quizRef = db.collection('quiz').doc(semaine);
  batch.set(quizRef, {
    questions: questions.map(({ id, question, reponse, concept_cle }) => ({
      id,
      question,
      reponse,
      concept_cle
    }))
  });

  await batch.commit();
  console.log(`[pipeline] Firestore écrit (items, digest, quiz) pour ${semaine}`);

  await sendPushToAll({
    title: 'Digest de la semaine disponible',
    body: `${itemsRetenus.length} items retenus, ${questions.length} questions de quiz.`,
    url: '/index.html'
  });
  console.log(`[pipeline] Run hebdo terminé — semaine ${semaine}`);

  return { semaine, nb_items: itemsRetenus.length, nb_questions: questions.length, nb_relances: itemsRelances.length };
}

// Job quotidien — relance push sur les items forts non consultés, sans plafond.
export async function runDailyRelance() {
  const snapshot = await db.collection('items').where('consulte', '==', false).get();

  const aRelancer = snapshot.docs.filter((doc) => {
    const data = doc.data();
    return data.signal_fort === true || data.score_pertinence >= 8;
  });

  if (aRelancer.length === 0) return { relances: 0 };

  const batch = db.batch();
  const now = new Date().toISOString();
  for (const doc of aRelancer) {
    batch.update(doc.ref, {
      nb_relances: (doc.data().nb_relances || 0) + 1,
      date_derniere_relance: now
    });
  }
  await batch.commit();

  await sendPushToAll({
    title: 'Infos importantes en attente',
    body: `${aRelancer.length} item(s) fort(s) toujours pas consulté(s) cette semaine.`,
    url: '/index.html'
  });

  return { relances: aRelancer.length };
}
