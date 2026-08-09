import cron, { type ScheduledTask } from 'node-cron';
import { processNotificationOutboxBatch } from '../services/notificationOutboxWorker.service';

let task: ScheduledTask | undefined;
let consecutiveInfrastructureFailures = 0;
let retryAfter = 0;

export function notificationWorkerEnabled(value = process.env.NOTIFICATION_OUTBOX_WORKER_ENABLED): boolean {
  return !['0', 'false', 'off'].includes((value ?? 'true').trim().toLowerCase());
}

export function sanitizedWorkerError(error: unknown): { error: string; code?: string; hint?: string } {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const candidate = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: unknown }).code : undefined;
  const code = typeof candidate === 'string' && /^[A-Z0-9_]+$/.test(candidate) ? candidate : undefined;
  const hint = code === 'P2021' || code === 'P2022' ? 'DATABASE_MIGRATIONS_REQUIRED' : undefined;
  return { error: errorName, ...(code ? { code } : {}), ...(hint ? { hint } : {}) };
}

async function runWorkerTick(pollSeconds: number): Promise<void> {
  if (Date.now() < retryAfter) return;
  try {
    await processNotificationOutboxBatch();
    consecutiveInfrastructureFailures = 0;
    retryAfter = 0;
  } catch (error) {
    consecutiveInfrastructureFailures += 1;
    const backoffSeconds = Math.min(300, pollSeconds * 2 ** Math.min(consecutiveInfrastructureFailures - 1, 6));
    retryAfter = Date.now() + backoffSeconds * 1000;
    console.error(JSON.stringify({ event: 'notification_outbox_worker_error', ...sanitizedWorkerError(error), retryInSeconds: backoffSeconds }));
  }
}

export function startNotificationOutboxWorker(): void {
  if (task) return;
  if (!notificationWorkerEnabled()) {
    console.info(JSON.stringify({ event: 'notification_outbox_worker_disabled' }));
    return;
  }
  const seconds = Math.max(5, Math.min(59, Number(process.env.NOTIFICATION_OUTBOX_POLL_SECONDS ?? 30) || 30));
  task = cron.schedule(`*/${seconds} * * * * *`, () => { void runWorkerTick(seconds); });
}
export function stopNotificationOutboxWorker(): void {
  task?.stop();
  task = undefined;
  consecutiveInfrastructureFailures = 0;
  retryAfter = 0;
}
