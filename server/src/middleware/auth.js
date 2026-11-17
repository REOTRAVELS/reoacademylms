import prisma from '../config/database.js';
import { verifyToken } from '../utils/jwt.js';
import { asyncHandler } from './asyncHandler.js';

const sessionToken = (req) => (
  req.cookies?.reoa_session || req.cookies?.[process.env.COOKIE_NAME || 'reoa_session']
);

export const authenticate = async (req, res, next) => {
  try {
    const token = sessionToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user || user.deletedAt) return res.status(401).json({ success: false, message: 'User not found' });
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ success: false, message: 'Account not active' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
};

export const authenticateApplicant = asyncHandler(async (req, res, next) => {
  const token = sessionToken(req);
  if (!token) return res.status(401).json({ success: false, message: 'Not authenticated' });
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { role: true },
  });
  if (!user || user.deletedAt || user.role.name !== 'STUDENT' || !['PENDING', 'ACTIVE', 'REJECTED'].includes(user.status)) {
    return res.status(403).json({ success: false, message: 'Application access is unavailable' });
  }
  req.user = user;
  next();
});

export const optionalAuth = async (req, res, next) => {
  try {
    const cookieName = process.env.COOKIE_NAME || 'reoa_session';
    const token = req.cookies?.[cookieName];
    if (!token) return next();
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { role: true } });
    if (user && !user.deletedAt && user.status === 'ACTIVE') req.user = user;
  } catch (e) {}
  next();
};
