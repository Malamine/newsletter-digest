import { runDailyRelance } from '../pipeline.js';

try {
  const result = await runDailyRelance();
  console.log('[job] daily-relance terminé avec succès', result);
  process.exit(0);
} catch (err) {
  console.error('[job] daily-relance a échoué', err);
  process.exit(1);
}
