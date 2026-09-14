import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { digestRouter } from './routes/digest.js';
import { quizRouter } from './routes/quiz.js';
import { itemsRouter } from './routes/items.js';
import { pushRouter } from './routes/push.js';
import { cronRouter } from './routes/cron.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/', (req, res) => {
  res.json({
    name: 'newsletter-digest-backend',
    endpoints: [
      'GET /health',
      'GET /digest/current',
      'GET /quiz/current',
      'POST /items/:id/consulte',
      'POST /quiz/reponses',
      'GET /push/vapid-public-key',
      'POST /push/subscriptions'
    ]
  });
});

app.use('/digest', digestRouter);
app.use('/quiz', quizRouter);
app.use('/items', itemsRouter);
app.use('/push', pushRouter);
app.use('/cron', cronRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur interne.' });
});

app.listen(config.port, () => {
  console.log(`Backend digest newsletter démarré sur le port ${config.port}`);
});
