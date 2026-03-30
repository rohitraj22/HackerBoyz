import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getDiscoveryGraph,
  searchDiscovery,
  getRelatedDiscoveryAssets,
  runDiscovery,
} from '../controllers/discoveryController.js';

const router = Router();

router.use(protect);

router.get('/graph', getDiscoveryGraph);
router.post('/search', searchDiscovery);
router.post('/run', runDiscovery);
router.get('/asset/:id/related', getRelatedDiscoveryAssets);

export default router;