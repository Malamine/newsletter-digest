/**
 * Applique `fn` à chaque élément de `items` avec au plus `limit` exécutions en parallèle.
 * Retourne les résultats dans l'ordre d'origine. Pensé pour du I/O (appels réseau) —
 * limite volontairement la concurrence pour rester sous les quotas RPM d'API externes.
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
