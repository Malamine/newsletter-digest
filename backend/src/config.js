import 'dotenv/config';

function required(name, value) {
  if (!value && process.env.NODE_ENV !== 'test') {
    console.warn(`[config] ${name} manquant — à définir avant le premier run réel.`);
  }
  return value;
}

export const config = {
  gcpProjectId: required('GCP_PROJECT_ID', process.env.GCP_PROJECT_ID),

  geminiApiKey: required('GEMINI_API_KEY', process.env.GEMINI_API_KEY),
  models: {
    curation: process.env.MODEL_CURATION || 'gemini-2.5-flash',
    conseil: process.env.MODEL_CONSEIL || 'gemini-2.5-flash',
    quiz: process.env.MODEL_QUIZ || 'gemini-2.5-flash'
  },

  gmail: {
    clientId: required('GMAIL_CLIENT_ID', process.env.GMAIL_CLIENT_ID),
    clientSecret: required('GMAIL_CLIENT_SECRET', process.env.GMAIL_CLIENT_SECRET),
    refreshToken: required('GMAIL_REFRESH_TOKEN', process.env.GMAIL_REFRESH_TOKEN),
    label: process.env.GMAIL_LABEL || 'NEWSLETTER'
  },

  cronSecret: required('CRON_SECRET', process.env.CRON_SECRET),

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    contactEmail: process.env.VAPID_CONTACT_EMAIL || 'mailto:malamin.tounkara.tr@gmail.com'
  },

  port: process.env.PORT || 8080
};
