// Bounded concurrency for file and network work.

/** Run `task` for each item, at most `limit` at a time, and return the results in the order of the items. */
export async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (let index = next++; index < items.length; index = next++) {
      const item = items[index];
      if (item !== undefined) {
        results[index] = await task(item);
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}
