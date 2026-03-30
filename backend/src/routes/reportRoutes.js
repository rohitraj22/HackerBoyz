import { Router } from 'express';
import { getCBOM, getReport, regenerateRecommendation } from '../controllers/reportController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/:id/cbom', protect, getCBOM);
router.get('/:id/report', protect, getReport);
router.post('/recommendations/:scanId/regenerate', protect, regenerateRecommendation);

export default router;