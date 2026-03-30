import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import scanRoutes from './routes/scanRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import historyRoutes from './routes/historyRoutes.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import cookieParser from 'cookie-parser';
import homeRoutes from './routes/homeRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import discoveryRoutes from './routes/discoveryRoutes.js';
import cbomRoutes from './routes/cbomRoutes.js';
import pqcRoutes from './routes/pqcRoutes.js';
import ratingRoutes from './routes/ratingRoutes.js';
import reportingRoutes from './routes/reportingRoutes.js';

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: true, // reflect requesting origin
    credentials: true, // allow cookies/auth headers
  })
);

app.use(morgan('dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Backend is healthy',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/history', historyRoutes);
app.use('/api', reportRoutes);
app.use('/api/home', homeRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/cbom', cbomRoutes);
app.use('/api/pqc', pqcRoutes);
app.use('/api/rating', ratingRoutes);
app.use('/api/reporting', reportingRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;