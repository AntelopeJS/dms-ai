/**
 * A DMS route refused, Analyst found nothing under the name it was given, or
 * the request asks what the table cannot answer. `detail` tells the model
 * what to do instead.
 */
export class AnalystRefusal extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly detail?: string,
  ) {
    super(reason);
  }
}
