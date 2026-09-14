import { Router } from 'express';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { db } from '../lib/firestore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const pushRouter = Router();

// GET /push/vapid-public-key — le front en a besoin pour PushManager.subscribe().
pushRouter.get('/vapid-public-key', (req, res) => {
  if (!config.vapid.publicKey) {
    return res.status(503).json({ error: 'VAPID_PUBLIC_KEY non configurée côté backend.' });
  }
  res.json({ publicKey: config.vapid.publicKey });
});

// POST /push/subscriptions — enregistre un abonnement Web Push créé côté client.
pushRouter.post('/subscriptions', asyncHandler(async (req, res) => {
  const subscription = req.body;
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Abonnement push invalide.' });
  }

  // id dérivé de l'endpoint pour dédupliquer les ré-abonnements du même device.
  const id = createHash('sha256').update(subscription.endpoint).digest('hex');

  await db.collection('push_subscriptions').doc(id).set({
    subscription,
    date_creation: new Date().toISOString()
  });

  res.status(201).json({ ok: true });
}));
