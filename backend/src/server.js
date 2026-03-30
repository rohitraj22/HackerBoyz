import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { startReportScheduleRunner } from './services/reports/scheduleRunner.js';

async function bootstrap() {
  try {
    await connectDB();
    startReportScheduleRunner();
    app.listen(env.port, () => {
      console.log(`Backend running on http://localhost:${env.port}`);
    });
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

bootstrap();
