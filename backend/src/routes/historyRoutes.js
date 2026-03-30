import { Router } from 'express';
import { getHistory } from '../controllers/historyController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

router.get('/', protect, getHistory);

export default router;