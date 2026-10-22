/**
 * Recuerda por un rato los ids que ya se borraron en el servidor, para que una
 * lista vieja que llegue tarde (una consulta que salió antes del borrado) no
 * los "resucite" en pantalla ni en el caché local.
 */
export class RecentDeletes {
  private readonly deletedAt = new Map<string, number>();

  constructor(private readonly ttlMs: number = 120_000) {}

  public mark(ids: readonly string[], now: number = Date.now()): void {
    for (const id of ids) this.deletedAt.set(id, now);
  }

  private prune(now: number): void {
    for (const [id, at] of this.deletedAt) {
      if (now - at > this.ttlMs) this.deletedAt.delete(id);
    }
  }

  public has(id: string, now: number = Date.now()): boolean {
    this.prune(now);
    return this.deletedAt.has(id);
  }

  public filter<T extends { id: string }>(list: readonly T[], now: number = Date.now()): T[] {
    this.prune(now);
    if (this.deletedAt.size === 0) return [...list];
    return list.filter((item) => !this.deletedAt.has(item.id));
  }
}
