// Génère une paire de clés VAPID pour le Web Push. À lancer une fois.
// La clé publique va aussi dans le frontend (VAPID_PUBLIC_KEY_PLACEHOLDER dans app.js).

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
