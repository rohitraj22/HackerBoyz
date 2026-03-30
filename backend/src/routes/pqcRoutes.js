import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { getPqcOverview, listPqcAssets } from '../controllers/pqcController.js';

const router = Router();

router.use(protect);

router.get('/overview', getPqcOverview);
router.get('/assets', listPqcAssets);

export default router;