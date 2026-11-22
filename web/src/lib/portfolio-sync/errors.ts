export class SyncError extends Error {
  constructor(
    message: string,
    readonly category: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}
