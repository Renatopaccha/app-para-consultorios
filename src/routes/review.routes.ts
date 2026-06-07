import { Router } from 'express';
import { getReviews, getReviewById, createReview } from '../controllers/review.controller';

const router = Router();

router.get('/', getReviews);
router.get('/:id', getReviewById);
router.post('/', createReview);

export default router;
