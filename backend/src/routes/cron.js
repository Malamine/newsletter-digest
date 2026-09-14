import { Router } from 'express';
import { config } from '../config.js';
import { runWeeklyPipeline, runDailyRelance } from '../pipeline.js';

export const cronRouter = Router();

function requireCronSecret(req, res, next) {
  const provided = req.get('X-Cron-Secret');
  if (!config.cronSecret || provided !== config.cronSecret) {
    return res.status(401).json({ error: 'Secret cron invalide ou manquant.' });
  }
  next();
}

cronRouter.use(requireCronSecret);

// POST /cron/generate-digest — appelé par Cloud Scheduler (hebdo).
cronRouter.post('/generate-digest', async (req, res) => {
  try {
    const result = await runWeeklyPipeline();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Échec pipeline hebdo', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /cron/relance — appelé par Cloud Scheduler (quotidien).
cronRouter.post('/relance', async (req, res) => {
  try {
    const result = await runDailyRelance();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Échec relance quotidienne', err);
    res.status(500).json({ error: err.message });
  }
});
