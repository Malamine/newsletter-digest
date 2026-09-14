import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, isoWeek } from '../lib/firestore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const quizRouter = Router();

// GET /quiz/current — quiz de la semaine en cours.
quizRouter.get('/current', asyncHandler(async (req, res) => {
  const semaine = isoWeek(new Date());
  const doc = await db.collection('quiz').doc(semaine).get();

  if (!doc.exists) {
    return res.status(404).json({ error: `Pas de quiz pour ${semaine}.` });
  }

  res.json({ semaine, questions: doc.data().questions });
}));

// POST /quiz/reponses — { question_id, concept_cle, autoevaluation: "su" | "pas_su" }
quizRouter.post('/reponses', asyncHandler(async (req, res) => {
  const { question_id, concept_cle, autoevaluation } = req.body || {};

  if (!question_id || !concept_cle || !['su', 'pas_su'].includes(autoevaluation)) {
    return res.status(400).json({ error: 'question_id, concept_cle et autoevaluation (su|pas_su) requis.' });
  }

  const semaine = isoWeek(new Date());
  const now = new Date().toISOString();

  await db.collection('reponses_quiz').doc(randomUUID()).set({
    question_id,
    date_semaine: semaine,
    concept_cle,
    autoevaluation,
    date_reponse: now
  });

  await updateConceptCouvert(concept_cle, semaine, autoevaluation);

  res.json({ ok: true });
}));

async function updateConceptCouvert(concept_cle, semaine, autoevaluation) {
  const ref = db.collection('concepts_couverts').doc(concept_cle);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) {
      tx.set(ref, {
        premiere_occurrence: semaine,
        nb_occurrences: 1,
        nb_fois_su: autoevaluation === 'su' ? 1 : 0,
        nb_fois_pas_su: autoevaluation === 'pas_su' ? 1 : 0
      });
      return;
    }

    const data = doc.data();
    tx.update(ref, {
      nb_occurrences: (data.nb_occurrences || 0) + 1,
      nb_fois_su: (data.nb_fois_su || 0) + (autoevaluation === 'su' ? 1 : 0),
      nb_fois_pas_su: (data.nb_fois_pas_su || 0) + (autoevaluation === 'pas_su' ? 1 : 0)
    });
  });
}
