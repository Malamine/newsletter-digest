import { Router } from 'express';
import { db, isoWeek } from '../lib/firestore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const digestRouter = Router();

// GET /digest/current — digest de la semaine en cours, avec ses items résolus.
digestRouter.get('/current', asyncHandler(async (req, res) => {
  const semaine = isoWeek(new Date());
  const digestDoc = await db.collection('digests').doc(semaine).get();

  if (!digestDoc.exists) {
    return res.status(404).json({ error: `Pas de digest pour ${semaine}.` });
  }

  const digest = digestDoc.data();
  const allIds = [...new Set([...digest.items_ids, ...digest.items_relances_ids])];

  const items = await Promise.all(
    allIds.map(async (id) => {
      const doc = await db.collection('items').doc(id).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    })
  );

  res.json({
    semaine,
    statut: digest.statut,
    date_generation: digest.date_generation,
    items: items.filter(Boolean),
    items_relances_ids: digest.items_relances_ids
  });
}));
