export function isConnectionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNABORTED';
}
