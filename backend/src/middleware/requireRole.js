export default function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: true, message: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}
