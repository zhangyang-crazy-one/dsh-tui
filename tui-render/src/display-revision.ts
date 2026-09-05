/** Compact display revisions retain source references without copying source into frame identifiers. */

/** Weakly owned revisions for immutable rows or explicit mutable-view fields. */
export class DisplayRevisionIndex {
  private next = 0
  private readonly entries = new WeakMap<object, { fields: readonly unknown[]; version: string }>()

  /**
   * Assign a short revision when an owner or one of its explicit fields changes.
   * @param owner - immutable history row, or stable mutable active-view owner.
   * @param fields - primitive values and immutable object references; no serialized transcript text.
   * @returns stable process-local revision until these fields change.
   */
  revision(owner: object, fields: readonly unknown[] = []): string {
    const previous = this.entries.get(owner)
    if (previous !== undefined && fields.length === previous.fields.length
      && fields.every((field, index) => Object.is(field, previous.fields[index]))) return previous.version
    const version = String(++this.next)
    this.entries.set(owner, { fields: fields.slice(), version })
    return version
  }
}
