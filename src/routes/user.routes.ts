import { Router } from 'express';
import { getUsers, getUserById, createUser } from '../controllers/user.controller';
import { authenticate, requireRole } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticate, requireRole(['SUPER_ADMIN']));
router.get('/', getUsers);
router.get('/:id', getUserById);
router.post('/', createUser);

export default router;
