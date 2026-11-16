export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Not authenticated' });
  if (!roles.includes(req.user.role.name)) {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
};
