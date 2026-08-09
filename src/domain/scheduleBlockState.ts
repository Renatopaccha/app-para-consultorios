import type { Prisma } from '../../generated/prisma';

/** The single domain definition of an active schedule block. */
export const ACTIVE_SCHEDULE_BLOCK_WHERE = Object.freeze({
  deletedAt: null,
}) satisfies Prisma.ScheduleBlockWhereInput;

export function activeScheduleBlockWhere(
  where: Prisma.ScheduleBlockWhereInput = {},
): Prisma.ScheduleBlockWhereInput {
  return { ...where, ...ACTIVE_SCHEDULE_BLOCK_WHERE };
}
