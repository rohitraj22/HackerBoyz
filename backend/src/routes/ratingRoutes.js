import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getEnterpriseRating,
  recalculateEnterpriseRating,
  listRatingAssets,
} from '../controllers/ratingController.js';

const router = Router();

router.use(protect);

router.get('/enterprise', getEnterpriseRating);
router.get('/assets', listRatingAssets);
router.post('/recalculate', recalculateEnterpriseRating);
router.post('/recalculate/:scanId', recalculateEnterpriseRating);

export default router;