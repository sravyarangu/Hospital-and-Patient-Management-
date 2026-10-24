export default function notFound(req, res) {
  res.status(404).json({
    error: true,
    message: `Route not found: ${req.originalUrl}`,
  });
}
