import { Router } from 'express';
import { db } from '../lib/firestore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const newslettersRouter = Router();

// GET /newsletters/:id — HTML brut de l'email source (rendu dans un iframe sandboxé côté front).
newslettersRouter.get('/:id', asyncHandler(async (req, res) => {
  const doc = await db.collection('newsletter_html').doc(req.params.id).get();

  if (!doc.exists) {
    return res.status(404).type('text/plain').send('Newsletter introuvable.');
  }

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Content-Security-Policy', "script-src 'none';");
  res.send(doc.data().html || '');
}));
