import type { Response } from 'express';
import type { AuthRequest } from '../middlewares/auth.middleware';
import prisma from '../prisma';

export async function listNotifications(req: AuthRequest, res: Response) {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20) || 20));
  const [items, unreadCount] = await Promise.all([
    prisma.userNotification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.userNotification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  return res.json({ unreadCount, items: items.map((item) => {
    const data = item.data && typeof item.data === 'object' && !Array.isArray(item.data) ? item.data as Record<string, unknown> : {};
    return { id: item.id, type: item.type, title: item.title, message: item.message, readAt: item.readAt, createdAt: item.createdAt, data: typeof data.appointmentId === 'string' ? { appointmentId: data.appointmentId } : null };
  }) });
}
export async function readNotification(req: AuthRequest, res: Response) {
  const changed = await prisma.userNotification.updateMany({ where: { id: String(req.params.id), userId: req.user!.id }, data: { readAt: new Date() } });
  if (!changed.count) return res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
  return res.json(await prisma.userNotification.findUniqueOrThrow({ where: { id: String(req.params.id) } }));
}
export async function readAllNotifications(req: AuthRequest, res: Response) {
  const result = await prisma.userNotification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  return res.json({ updated: result.count });
}
