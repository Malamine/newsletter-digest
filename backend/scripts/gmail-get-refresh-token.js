// Script à lancer UNE FOIS en local pour obtenir un refresh token Gmail.
// Prérequis : un OAuth client "Desktop app" créé dans ton projet GCP
// (Google Cloud Console > APIs & Services > Identifiants), avec l'API Gmail activée.
//
// Usage :
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-get-refresh-token.js
//
// Le refresh token affiché à la fin va dans GMAIL_REFRESH_TOKEN (.env local + Secret Manager en prod).
//
// Utilise le flux "loopback" (RFC 8252) : un petit serveur HTTP local capte la redirection
// Google avec le code d'autorisation. Google a définitivement coupé l'ancien flux OOB
// (urn:ietf:wg:oauth:2.0:oob) — les clients "Desktop app" acceptent nativement les redirections
// vers n'importe quel port sur http://localhost, pas besoin de le déclarer dans la console.

import { google } from 'googleapis';
import http from 'node:http';

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET requis en variables d\'environnement.');
  process.exit(1);
}

const server = http.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const redirectUri = `http://127.0.0.1:${port}`;

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.readonly']
});

console.log('\nOuvre cette URL, connecte-toi avec la boîte mail dédiée aux newsletters, et autorise l\'accès :\n');
console.log(authUrl);
console.log('\nEn attente de la redirection...\n');

const code = await new Promise((resolve, reject) => {
  server.on('request', (req, res) => {
    const url = new URL(req.url, redirectUri);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (error) {
      res.end(`<p>Erreur : ${error}. Tu peux fermer cet onglet.</p>`);
      reject(new Error(error));
    } else if (code) {
      res.end('<p>Autorisation reçue, tu peux fermer cet onglet et revenir au terminal.</p>');
      resolve(code);
    } else {
      res.end('<p>Requête inattendue.</p>');
    }
  });
});

server.close();

const { tokens } = await oauth2Client.getToken(code);
console.log('Refresh token (à mettre dans GMAIL_REFRESH_TOKEN) :\n');
console.log(tokens.refresh_token);
