// Script à lancer UNE FOIS en local pour obtenir un refresh token Gmail.
// Prérequis : un OAuth client "Desktop app" créé dans ton projet GCP
// (Google Cloud Console > APIs & Services > Identifiants), avec l'API Gmail activée.
//
// Usage :
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-get-refresh-token.js
//
// Le refresh token affiché à la fin va dans GMAIL_REFRESH_TOKEN (.env local + Secret Manager en prod).

import { google } from 'googleapis';
import readline from 'node:readline/promises';

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET requis en variables d\'environnement.');
  process.exit(1);
}

const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.readonly']
});

console.log('\n1. Ouvre cette URL, connecte-toi avec la boîte mail dédiée aux newsletters :\n');
console.log(authUrl);
console.log('\n2. Autorise l\'accès, copie le code affiché, et colle-le ci-dessous.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const code = await rl.question('Code : ');
rl.close();

const { tokens } = await oauth2Client.getToken(code.trim());
console.log('\nRefresh token (à mettre dans GMAIL_REFRESH_TOKEN) :\n');
console.log(tokens.refresh_token);
