export default function errorHandler(error, req, res, next) {
  const message = error?.message || 'Unexpected server error.';
  const isDevelopment = process.env.NODE_ENV === 'development';

  if (isDevelopment) {
    console.error('[backend:error]', message);
  } else {
    console.error('[backend:error]', 'An internal server error occurred.');
  }

  res.status(error?.statusCode || 500).json({
    error: true,
    message: message,
  });
}
