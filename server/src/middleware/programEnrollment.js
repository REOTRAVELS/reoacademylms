import { asyncHandler } from './asyncHandler.js';
import { getStudentIntakeAccess } from '../utils/intakeAccess.js';

const setEnrollmentContext = (req, enrollment) => {
  req.activeProgramEnrollment = {
    id: enrollment.id,
    studentId: enrollment.studentId,
    programmeId: enrollment.programmeId,
    programOfferingId: enrollment.programOfferingId,
    intakeId: enrollment.intakeId,
  };
};

const waitingResponse = (res, enrollment, now) => res.status(403).json({
  success: false,
  code: 'ACADEMIC_ACCESS_NOT_STARTED',
  message: 'Academic access will be available when your Program starts.',
  intake: {
    id: enrollment.programOffering.intake.id,
    gateNumber: enrollment.programOffering.intake.gateNumber,
    season: enrollment.programOffering.intake.season,
    year: enrollment.programOffering.intake.year,
    academicStartDate: enrollment.programOffering.academicStartDate,
    timezone: enrollment.programOffering.intake.timezone,
    programmeTitle: enrollment.programOffering.programme.title,
  },
  serverNow: now,
});

export const requireActiveProgramEnrollment = asyncHandler(async (req, res, next) => {
  if (req.user.role.name !== 'STUDENT') return next();
  const now = new Date();
  const access = await getStudentIntakeAccess(req.user.id, now);
  if (access.state === 'WAITING') return waitingResponse(res, access.enrollment, now);
  if (access.state !== 'ELIGIBLE') {
    return res.status(403).json({
      success: false,
      message: 'An active Program enrollment is required to access academic resources.',
    });
  }
  setEnrollmentContext(req, access.enrollment);
  next();
});

export const requireProgramDashboardAccess = asyncHandler(async (req, res, next) => {
  if (req.user.role.name !== 'STUDENT') return next();
  const now = new Date();
  const access = await getStudentIntakeAccess(req.user.id, now);
  if (access.state === 'NONE') {
    return res.status(403).json({
      success: false,
      message: 'An active Program enrollment is required to access academic resources.',
    });
  }
  setEnrollmentContext(req, access.enrollment);
  if (access.state === 'WAITING') req.waitingProgramEnrollment = access.enrollment;
  next();
});
