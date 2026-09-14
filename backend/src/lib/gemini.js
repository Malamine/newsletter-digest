import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

const genai = new GoogleGenAI({ apiKey: config.geminiApiKey });

function isRateLimitError(err) {
  const status = err?.status ?? err?.code ?? err?.response?.status;
  return status === 429 || /RESOURCE_EXHAUSTED|rate.?limit/i.test(err?.message || '');
}

async function generateContentWithBackoff(params, { maxRetries = 5, baseDelayMs = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await genai.models.generateContent(params);
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= maxRetries) throw err;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 500;
      console.warn(`Gemini 429 — retry ${attempt + 1}/${maxRetries} dans ${Math.round(delay)}ms`);
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
