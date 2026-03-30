import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getLatestCbom,
  getCbomByScan,
  rebuildCbom,
} from '../controllers/cbomController.js';

const router = Router();

router.use(protect);

router.get('/latest', getLatestCbom);
router.get('/:scanId', getCbomByScan);
router.post('/:scanId/rebuild', rebuildCbom);

export default router;