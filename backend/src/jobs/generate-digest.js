import { runWeeklyPipeline } from '../pipeline.js';

try {
  const result = await runWeeklyPipeline();
  console.log('[job] generate-digest terminé avec succès', result);
  process.exit(0);
} catch (err) {
  console.error('[job] generate-digest a échoué', err);
  process.exit(1);
}
