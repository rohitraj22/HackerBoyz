import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  logger.error(err.message || 'Unhandled server error', {
    stack: err.stack,
    route: req.originalUrl,
    method: req.method
  });

  if (err?.name === 'ValidationError' && err?.errors) {
    const messages = Object.values(err.errors)
      .map((item) => item?.message)
      .filter(Boolean);

    return res.status(400).json({
      success: false,
      message: messages[0] || 'Validation failed',
      errors: messages
    });
  }

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {})
  });
}
