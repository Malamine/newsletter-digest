import { Router } from 'express';
import { db, isoWeek } from '../lib/firestore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const itemsRouter = Router();

// POST /items/:id/consulte — marque un item comme lu, met à jour le statut du digest de sa semaine.
itemsRouter.post('/:id/consulte', asyncHandler(async (req, res) => {
  const itemRef = db.collection('items').doc(req.params.id);
  const itemDoc = await itemRef.get();

  if (!itemDoc.exists) {
    return res.status(404).json({ error: 'Item introuvable.' });
  }

  const now = new Date().toISOString();
  await itemRef.update({ consulte: true, date_consultation: now });

  const semaine = itemDoc.data().date_semaine;
  await updateDigestStatut(semaine);

  res.json({ ok: true });
}));

async function updateDigestStatut(semaine) {
  const digestRef = db.collection('digests').doc(semaine);
  const digestDoc = await digestRef.get();
  if (!digestDoc.exists) return;

  const digest = digestDoc.data();
  const ids = [...new Set([...digest.items_ids, ...digest.items_relances_ids])];
  const items = await Promise.all(ids.map((id) => db.collection('items').doc(id).get()));
  const consultes = items.filter((doc) => doc.exists && doc.data().consulte);

  let statut = 'non_consulte';
  if (consultes.length === items.length && items.length > 0) statut = 'consulte';
  else if (consultes.length > 0) statut = 'partiellement_consulte';

  const update = { statut };
  if (statut !== 'non_consulte' && !digest.date_premiere_consultation) {
    update.date_premiere_consultation = new Date().toISOString();
  }
  await digestRef.update(update);
}
