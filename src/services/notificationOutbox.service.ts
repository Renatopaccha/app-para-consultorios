import crypto from 'crypto';
import type { Prisma } from '../../generated/prisma';

export const NOTIFICATION_EVENT_TYPES = [
  'APPOINTMENT_CREATED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED',
  'APPOINTMENT_CONFIRMATION_REQUIRED', 'APPOINTMENT_REMINDER', 'PATIENT_INVITED',
] as const;
export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number];

type SafePayload = {
  previousStartsAt?: string;
  newStartsAt?: string;
  patientMessage?: string | null;
  reminderKind?: '24H' | '2H' | '1H';
};

function encryptionKey(): Buffer {
  const explicit = process.env.NOTIFICATION_OUTBOX_ENCRYPTION_KEY;
  if (process.env.NODE_ENV === 'production' && !explicit) throw new Error('NOTIFICATION_OUTBOX_ENCRYPTION_KEY is required in production');
  const source = explicit || process.env.JWT_SECRET;
  if (!source) throw new Error('NOTIFICATION_OUTBOX_ENCRYPTION_KEY is required');
  return crypto.createHash('sha256').update(source).digest();
}

export function validateNotificationOutboxConfiguration(): void { encryptionKey(); }

export function encryptOutboxSecret(value: Record<string, string>): string {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptOutboxSecret(value: string): Record<string, string> {
  const [ivPart, tagPart, bodyPart] = value.split('.');
  if (!ivPart || !tagPart || !bodyPart) throw new Error('INVALID_ENCRYPTED_OUTBOX_PAYLOAD');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bodyPart, 'base64url')), decipher.final()]).toString('utf8')) as Record<string, string>;
}

export async function enqueueNotification(
  tx: Prisma.TransactionClient,
  input: { eventType: NotificationEventType; aggregateId: string; deduplicationKey: string; payload?: SafePayload; secret?: Record<string, string> },
): Promise<void> {
  await tx.notificationOutbox.create({ data: {
    eventType: input.eventType,
    aggregateType: 'APPOINTMENT',
    aggregateId: input.aggregateId,
    deduplicationKey: input.deduplicationKey,
    payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    encryptedPayload: input.secret ? encryptOutboxSecret(input.secret) : null,
  } });
  console.info(JSON.stringify({ event: 'notification_outbox_created', eventType: input.eventType, aggregateId: input.aggregateId }));
}

export function sanitizeOutboxError(error: unknown): string {
  const name = error instanceof Error ? error.name : 'UnknownError';
  return name.slice(0, 120);
}
