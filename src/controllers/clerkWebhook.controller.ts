import type { Request, Response } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import { Prisma } from '../../generated/prisma';
import prisma from '../prisma';
import { normalizeEmail } from '../services/emailIdentity.service';

const PROVISIONED_FIRST_NAME = 'Usuario';
const PROVISIONED_LAST_NAME = 'Zenda';

export async function handleClerkWebhook(req: Request, res: Response) {
  let event;
  try {
    event = await verifyWebhook(req);
  } catch {
    return res.status(400).json({ code: 'CLERK_WEBHOOK_INVALID_SIGNATURE', message: 'Webhook no válido.' });
  }

  if (event.type !== 'user.created') {
    return res.status(200).json({ received: true });
  }

  const clerkUserId = event.data.id;
  const primaryEmail = event.data.email_addresses.find(
    (candidate) => candidate.id === event.data.primary_email_address_id,
  );
  if (!clerkUserId || !primaryEmail || primaryEmail.verification?.status !== 'verified') {
    return res.status(422).json({
      code: 'CLERK_PRIMARY_EMAIL_REQUIRED',
      message: 'El evento no contiene un correo principal verificado.',
    });
  }

  const email = normalizeEmail(primaryEmail.email_address);
  if (!email) {
    return res.status(422).json({
      code: 'CLERK_PRIMARY_EMAIL_REQUIRED',
      message: 'El evento no contiene un correo principal verificado.',
    });
  }

  try {
    await prisma.user.create({
      data: {
        clerkUserId,
        email,
        emailNormalized: email,
        firstName: PROVISIONED_FIRST_NAME,
        lastName: PROVISIONED_LAST_NAME,
        emailVerifiedAt: new Date(),
        // Security boundary: webhook metadata and profile fields are controlled
        // outside Zenda. Never derive roles from public_metadata, unsafe_metadata,
        // private_metadata, names, or any other Clerk payload field.
        role: 'PATIENT',
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
      });
      if (existing) return res.status(200).json({ received: true, duplicate: true });

      return res.status(409).json({
        code: 'CLERK_USER_PROVISIONING_CONFLICT',
        message: 'No se pudo aprovisionar la identidad Clerk.',
      });
    }

    console.error('[ClerkWebhook] No se pudo aprovisionar el usuario.');
    return res.status(500).json({
      code: 'CLERK_USER_PROVISIONING_FAILED',
      message: 'No se pudo aprovisionar la identidad Clerk.',
    });
  }

  return res.status(200).json({ received: true, created: true });
}
