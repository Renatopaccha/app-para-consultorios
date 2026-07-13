import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { BookingError } from '../services/appointmentBooking.service';
import { getFinancePayments, getFinanceSummary } from '../services/finance.service';

const actor = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });
const handle = (error: unknown, res: Response) => error instanceof BookingError ? res.status(error.status).json({ error: error.code, message: error.message }) : res.status(500).json({ error: 'INTERNAL_ERROR' });
export async function summary(req: AuthRequest, res: Response) { try { return res.json(await getFinanceSummary(actor(req), req.query as Record<string, string | undefined>)); } catch (error) { return handle(error, res); } }
export async function payments(req: AuthRequest, res: Response) { try { return res.json(await getFinancePayments(actor(req), req.query as Record<string, string | undefined>)); } catch (error) { return handle(error, res); } }
