import { AuthIdentityLinkEvent, Prisma } from '../../generated/prisma';
import prisma from '../prisma';

export type LinkClerkIdentityInput = {
  userId: string;
  clerkUserId: string;
  actorUserId?: string;
  requestId?: string;
};

type AuthIdentityLinkErrorCode = 'USER_NOT_FOUND' | 'ZENDA_USER_ALREADY_LINKED' | 'CLERK_IDENTITY_ALREADY_LINKED';

export class AuthIdentityLinkError extends Error {
  constructor(
    public readonly code: AuthIdentityLinkErrorCode,
    public readonly event: AuthIdentityLinkEvent,
    public readonly userId?: string,
  ) {
    super(code);
  }
}

export async function recordIdentityLinkAudit(input: {
  clerkUserId: string;
  event: AuthIdentityLinkEvent;
  userId?: string;
  actorUserId?: string;
  requestId?: string;
  reasonCode?: string;
}) {
  await prisma.authIdentityLinkAudit.create({ data: input });
}

/**
 * Persistence primitive for a future verified link ceremony. It intentionally
 * does not expose an HTTP endpoint: this phase has no safe browser ceremony yet.
 * Callers must prove both the active Clerk session and the legacy account before
 * invoking it.
 */
export async function linkClerkIdentity(input: LinkClerkIdentityInput) {
  if (!input.clerkUserId.trim()) throw new AuthIdentityLinkError('CLERK_IDENTITY_ALREADY_LINKED', AuthIdentityLinkEvent.COLLISION, input.userId);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, clerkUserId: true } });
      if (!user) {
        throw new AuthIdentityLinkError('USER_NOT_FOUND', AuthIdentityLinkEvent.LINK_REJECTED);
      }
      if (user.clerkUserId === input.clerkUserId) {
        return { userId: user.id, clerkUserId: input.clerkUserId, linkedNow: false };
      }
      if (user.clerkUserId) {
        throw new AuthIdentityLinkError('ZENDA_USER_ALREADY_LINKED', AuthIdentityLinkEvent.COLLISION, user.id);
      }

      const owner = await tx.user.findUnique({ where: { clerkUserId: input.clerkUserId }, select: { id: true } });
      if (owner && owner.id !== user.id) {
        throw new AuthIdentityLinkError('CLERK_IDENTITY_ALREADY_LINKED', AuthIdentityLinkEvent.COLLISION, user.id);
      }

      const claimed = await tx.user.updateMany({
        where: { id: user.id, clerkUserId: null },
        data: { clerkUserId: input.clerkUserId },
      });
      if (claimed.count !== 1) {
        const current = await tx.user.findUnique({ where: { id: user.id }, select: { clerkUserId: true } });
        if (current?.clerkUserId === input.clerkUserId) return { userId: user.id, clerkUserId: input.clerkUserId, linkedNow: false };
        throw new AuthIdentityLinkError('ZENDA_USER_ALREADY_LINKED', AuthIdentityLinkEvent.COLLISION, user.id);
      }

      await tx.authIdentityLinkAudit.create({ data: { userId: user.id, clerkUserId: input.clerkUserId, event: AuthIdentityLinkEvent.LINKED, actorUserId: input.actorUserId, requestId: input.requestId } });
      return { userId: user.id, clerkUserId: input.clerkUserId, linkedNow: true };
    });
  } catch (error) {
    if (error instanceof AuthIdentityLinkError) {
      await recordIdentityLinkAudit({ userId: error.userId, clerkUserId: input.clerkUserId, event: error.event, actorUserId: input.actorUserId, requestId: input.requestId, reasonCode: error.code });
      throw error;
    }
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    // A unique-constraint collision rolls back its transaction, so the audit
    // entry must be written separately after the failed claim.
    await recordIdentityLinkAudit({ userId: input.userId, clerkUserId: input.clerkUserId, event: AuthIdentityLinkEvent.COLLISION, actorUserId: input.actorUserId, requestId: input.requestId, reasonCode: 'CLERK_IDENTITY_ALREADY_LINKED' });
    throw new AuthIdentityLinkError('CLERK_IDENTITY_ALREADY_LINKED', AuthIdentityLinkEvent.COLLISION, input.userId);
  }
}
