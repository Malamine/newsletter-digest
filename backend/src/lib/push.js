import webpush from 'web-push';
import { config } from '../config.js';
import { db } from './firestore.js';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.contactEmail, config.vapid.publicKey, config.vapid.privateKey);
}

/**
 * Envoie une notification push à tous les abonnements enregistrés.
 * Supprime silencieusement les abonnements expirés/révoqués (410/404).
 */
export async function sendPushToAll({ title, body, url }) {
  const snapshot = await db.collection('push_subscriptions').get();
  if (snapshot.empty) return { sent: 0, removed: 0 };

  const payload = JSON.stringify({ title, body, url });
  let sent = 0;
  let removed = 0;

  await Promise.all(
    snapshot.docs.map(async (doc) => {
      try {
        await webpush.sendNotification(doc.data().subscription, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await doc.ref.delete();
          removed++;
        } else {
          console.error('Échec envoi push', doc.id, err.message);
        }
      }
    })
  );

  return { sent, removed };
}
