import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// Un 429 sur un quota JOURNALIER ("PerDay") ne se résoudra pas en 30s — retenter ne fait que
// cramer encore plus du quota déjà épuisé pour la journée. On échoue vite dans ce cas précis.
function isDailyQuotaExhausted(err) {
  return /PerDay|per[- ]day/i.test(err?.message || '');
}

// 429 (quota RPM/burst dépassé) et 503 (modèle temporairement surchargé côté Google) sont
// transitoires — ça vaut le coup de réessayer avec backoff, sauf si c'est un quota journalier.
function isRetryableError(err) {
  if (isDailyQuotaExhausted(err)) return false;
  const status = err?.status ?? err?.code ?? err?.response?.status;
  if (status === 429 || status === 503) return true;
  return /RESOURCE_EXHAUSTED|rate.?limit|UNAVAILABLE|high demand/i.test(err?.message || '');
}

async function generateContentWithBackoff(params, { maxRetries = 5, baseDelayMs = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await genai.models.generateContent(params);
    } catch (err) {
      if (!isRetryableError(err) || attempt >= maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 500;
      console.warn(`Gemini erreur transitoire (${err?.status ?? '?'}) — retry ${attempt + 1}/${maxRetries} dans ${Math.round(delay)}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Appelle Gemini avec un system prompt + un user prompt, retourne le texte brut.
 * `thinkingBudget: 0` désactive le raisonnement interne (2.5 Flash) — à utiliser pour les
 * tâches simples (tri/scoring) où il bouffe le budget de tokens de sortie sans valeur ajoutée,
 * au risque de tronquer la réponse avant la fin (cause typique d'un JSON incomplet).
 * Retry avec backoff exponentiel sur les 429 (quota dépassé) — évite qu'un run entier plante
 * pour un dépassement de quota par minute ponctuel.
 */
export async function generateText({ model, systemPrompt, userPrompt, maxOutputTokens = 32768, thinkingBudget }) {
  const response = await generateContentWithBackoff({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      maxOutputTokens,
      ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {})
    }
  });

  if (!response.text) {
    const finishReason = response.candidates?.[0]?.finishReason;
    throw new Error(`Réponse Gemini vide (finishReason: ${finishReason || 'inconnu'}).`);
  }

  return response.text;
}

export function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}
