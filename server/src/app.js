import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import usersRoutes from './routes/usersRoutes.js';
import programmesRoutes from './routes/programmesRoutes.js';
import intakesRoutes from './routes/intakesRoutes.js';
import applicationsRoutes from './routes/applicationsRoutes.js';
import programEnrollmentsRoutes from './routes/programEnrollmentsRoutes.js';
import cohortsRoutes from './routes/cohortsRoutes.js';
import coursesRoutes from './routes/coursesRoutes.js';
import assessmentsRoutes from './routes/assessmentsRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import resourcesRoutes from './routes/resourcesRoutes.js';
import progressRoutes from './routes/progressRoutes.js';
import liveClassesRoutes from './routes/liveClassesRoutes.js';
import courseDiscussionsRoutes from './routes/courseDiscussionsRoutes.js';
import { notFound, errorHandler, requestContext } from './middleware/errorHandler.js';
import prisma from './config/database.js';

const app = express();

app.use(requestContext);
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
app.use('/api', limiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }));
app.use('/api/auth/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use('/api/users/:id/password', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));

app.get('/api/health', (_req, res) => res.json({ success: true, message: 'OK' }));
app.get('/api/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ success: true, message: 'Ready' });
  } catch (error) {
    console.error('Readiness check failed', error);
    return res.status(503).json({ success: false, message: 'Service unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/programmes', programmesRoutes);
app.use('/api/intakes', intakesRoutes);
app.use('/api/applications', applicationsRoutes);
app.use('/api/program-enrollments', programEnrollmentsRoutes);
app.use('/api/cohorts', cohortsRoutes);
app.use('/api/courses', coursesRoutes);
app.use('/api/assessments', assessmentsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/live-classes', liveClassesRoutes);
app.use('/api/course-discussions', courseDiscussionsRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
