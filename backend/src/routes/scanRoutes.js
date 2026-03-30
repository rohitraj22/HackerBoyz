import { Router } from 'express';
import { runScan, getScanById, listScans, deleteScan } from '../controllers/scanController.js';
import { protect } from '../middlewares/authMiddleware.js';

const router = Router();

router.post('/run', protect, runScan);
router.get('/', protect, listScans);
router.get('/:id', protect, getScanById);
router.delete('/:id', protect, deleteScan);

export default router;