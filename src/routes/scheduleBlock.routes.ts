import { Router } from 'express';
import { authenticate, requireRole } from '../middlewares/auth.middleware';
import { createScheduleBlock, deleteScheduleBlock, listScheduleBlocks } from '../controllers/scheduleBlock.controller';
const router = Router();
router.use(authenticate);
router.get('/', listScheduleBlocks);
router.post('/', requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT']), createScheduleBlock);
router.delete('/:id', requireRole(['DOCTOR', 'CLINIC_ADMIN', 'ASSISTANT']), deleteScheduleBlock);
export default router;
