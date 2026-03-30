import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getInventorySummary,
  listInventoryAssets,
  getInventoryAssetById,
  updateInventoryAssetStatus,
} from '../controllers/inventoryController.js';

const router = Router();

router.use(protect);

router.get('/summary', getInventorySummary);
router.get('/assets', listInventoryAssets);
router.get('/assets/:id', getInventoryAssetById);
router.patch('/assets/:id/status', updateInventoryAssetStatus);

export default router;