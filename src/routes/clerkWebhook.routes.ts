import { Router } from 'express';
import { handleClerkWebhook } from '../controllers/clerkWebhook.controller';

const router = Router();

// Public by design: Clerk authenticates this request through its Svix signature.
router.post('/', handleClerkWebhook);

export default router;
