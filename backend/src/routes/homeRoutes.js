import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import { getHomeSummary } from '../controllers/homeController.js';

const router = Router();

router.use(protect);
router.get('/summary', getHomeSummary);

export default router;