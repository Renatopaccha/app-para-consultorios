import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { BookingError } from '../services/appointmentBooking.service';
import { confirmCashPayment, listCashPayments, lookupCashPayment, reissueCashPaymentCode } from '../services/cashPayment.service';

const actor = (req: AuthRequest) => ({ id: req.user!.id, role: req.user!.role });
const handle = (error: unknown, res: Response) => error instanceof BookingError ? res.status(error.status).json({ error: error.code, message: error.message }) : res.status(500).json({ error: 'INTERNAL_ERROR' });
const requestIp = (req: AuthRequest) => req.ip || req.socket.remoteAddress || 'unknown';

export async function lookup(req: AuthRequest, res: Response) { try { return res.json(await lookupCashPayment(String(req.body.code || ''), actor(req), requestIp(req))); } catch (error) { return handle(error, res); } }
export async function pending(req: AuthRequest, res: Response) { try { return res.json(await listCashPayments(actor(req), req.query as Record<string, string | undefined>)); } catch (error) { return handle(error, res); } }
export async function confirm(req: AuthRequest, res: Response) { try { return res.json(await confirmCashPayment(String(req.params.paymentId), String(req.body.code || ''), String(req.body.idempotencyKey || ''), actor(req), requestIp(req))); } catch (error) { return handle(error, res); } }
export async function reissue(req: AuthRequest, res: Response) { try { return res.json(await reissueCashPaymentCode(String(req.params.paymentId), actor(req), typeof req.body.reason === 'string' ? req.body.reason : undefined)); } catch (error) { return handle(error, res); } }
