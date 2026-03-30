import { Router } from 'express';
import { protect } from '../middlewares/authMiddleware.js';
import {
  getReportingOptions,
  generateReport,
  createReportSchedule,
  listReportSchedules,
  updateReportSchedule,
  deleteReportSchedule,
  listGeneratedReports,
  downloadGeneratedReport,
} from '../controllers/reportingController.js';

const router = Router();

router.use(protect);

router.get('/options', getReportingOptions);
router.post('/generate', generateReport);
router.post('/schedules', createReportSchedule);
router.get('/schedules', listReportSchedules);
router.patch('/schedules/:id', updateReportSchedule);
router.delete('/schedules/:id', deleteReportSchedule);
router.get('/generated', listGeneratedReports);
router.get('/generated/:id/download', downloadGeneratedReport);

export default router;