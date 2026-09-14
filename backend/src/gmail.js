import { google } from 'googleapis';
import { config } from './config.js';

function client() {
  const oauth2Client = new google.auth.OAuth2(config.gmail.clientId, config.gmail.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.gmail.refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function decodeBase64Url(data) {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractBody(payload) {
  if (!payload) return '';

  const collectParts = (part, acc = { text: '', html: '' }) => {
    if (part.parts) {
      part.parts.forEach((p) => collectParts(p, acc));
      return acc;
    }
    if (!part.body?.data) return acc;
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/plain') acc.text += decoded + '\n';
    if (part.mimeType === 'text/html') acc.html += decoded + '\n';
    return acc;
  };

  const { text, html } = collectParts(payload);
  if (text.trim()) return text.trim();
  if (html.trim()) return stripHtml(html);
  return '';
}

function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

/**
 * Récupère les mails du label GMAIL_LABEL reçus dans les `days` derniers jours.
 * Retourne une liste d'items bruts { id, titre, source, date, contenu }.
 */
export async function fetchNewsletterEmails(days = 7) {
  const gmail = client();

  const labelsRes = await gmail.users.labels.list({ userId: 'me' });
  const label = labelsRes.data.labels?.find(
    (l) => l.name.toUpperCase() === config.gmail.label.toUpperCase()
  );
  if (!label) {
    throw new Error(`Label Gmail "${config.gmail.label}" introuvable sur ce compte.`);
  }

  const after = Math.floor(Date.now() / 1000) - days * 86400;
  const listRes = await gmail.users.messages.list({
    userId: 'me',
    labelIds: [label.id],
    q: `after:${after}`,
    maxResults: 200
  });

  const messages = listRes.data.messages || [];
  const items = [];

  for (const { id } of messages) {
    const msgRes = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
    const headers = msgRes.data.payload?.headers;
    const from = header(headers, 'From');
    const subject = header(headers, 'Subject');
    const dateHeader = header(headers, 'Date');

    items.push({
      id,
      titre: subject,
      source: from.replace(/<.*>/, '').trim() || from,
      date: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
      contenu: extractBody(msgRes.data.payload).slice(0, 20000) // garde-fou taille par item
    });
  }

  return items;
}
