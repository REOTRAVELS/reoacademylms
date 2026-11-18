import prisma from '../config/database.js';
import { ok } from '../utils/response.js';
import { activeProgramCohortForStudent, studentCourseAccessWhere } from '../utils/courseAccess.js';
import { studentNotificationAudienceWhere } from '../utils/notificationPolicies.js';
import { assessmentOfferingForStudentWhere } from '../utils/assessmentAccess.js';

export const adminDashboard = async (req, res) => {
  const now = new Date();
  const [
    totalStudents, activeStudents, pendingRegistrations, totalTrainers,
    activeProgrammes, activeIntakes, totalEnrolments, totalCourses, publishedCourses,
    draftCourses, publishedAssessments, publishedExaminations, examinationAttempts, upcomingLiveClasses,
  ] = await Promise.all([
    prisma.user.count({ where: { role: { name: 'STUDENT' }, deletedAt: null } }),
    prisma.user.count({ where: { role: { name: 'STUDENT' }, status: 'ACTIVE', deletedAt: null } }),
    prisma.user.count({ where: { role: { name: 'STUDENT' }, status: 'PENDING', deletedAt: null } }),
    prisma.user.count({ where: { role: { name: 'TRAINER' }, status: 'ACTIVE', deletedAt: null } }),
    prisma.programme.count({ where: { status: 'ACTIVE' } }),
    prisma.intake.count({ where: { status: 'ACTIVE' } }),
    prisma.enrolment.count(),
    prisma.course.count(),
    prisma.course.count({ where: { status: 'PUBLISHED' } }),
    prisma.course.count({ where: { status: 'DRAFT' } }),
    prisma.assessment.count({ where: { status: 'PUBLISHED' } }),
    prisma.assessment.count({ where: { status: 'PUBLISHED', type: 'EXAMINATION' } }),
    prisma.assessmentAttempt.count({ where: { assessment: { type: 'EXAMINATION' } } }),
    prisma.liveClass.count({ where: { status: 'SCHEDULED', startsAt: { gte: now } } }),
  ]);

  const [recentRegistrations, recentExaminationAttempts] = await Promise.all([
    prisma.user.findMany({
      where: { role: { name: 'STUDENT' }, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, firstName: true, lastName: true, email: true, status: true, createdAt: true },
    }),
    prisma.assessmentAttempt.findMany({
      where: { assessment: { type: 'EXAMINATION' } },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        startedAt: true,
        submittedAt: true,
        score: true,
        maxScore: true,
        status: true,
        resultsReleasedAt: true,
        student: { select: { firstName: true, lastName: true } },
        assessment: {
          select: {
            id: true,
            title: true,
            resultsReleased: true,
            programOffering: {
              select: {
                intake: { select: { gateNumber: true, season: true, year: true } },
                programme: { select: { title: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  const recentAudit = await prisma.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: {
      id: true,
      action: true,
      entity: true,
      createdAt: true,
      actor: { select: { firstName: true, lastName: true } },
    },
  });

  return ok(res, {
    stats: {
      totalStudents,
      activeStudents,
      pendingRegistrations,
      totalTrainers,
      activeProgrammes,
      activeIntakes,
      totalEnrolments,
      totalCourses,
      publishedCourses,
      draftCourses,
      publishedAssessments,
      publishedExaminations,
      examinationAttempts,
      upcomingLiveClasses,
    },
    recentRegistrations,
    recentExaminationAttempts,
    recentAudit: recentAudit.map((a) => ({
      id: a.id, action: a.action, entity: a.entity, createdAt: a.createdAt,
      actor: a.actor ? `${a.actor.firstName} ${a.actor.lastName}` : 'System',
    })),
  });
};

export const trainerDashboard = async (req, res) => {
  const trainerId = req.user.id;
  const cohortAccess = {
    OR: [
      { trainers: { some: { trainerId } } },
      { courses: { some: { course: { trainers: { some: { trainerId } } } } } },
    ],
  };
  const courseAccess = { trainers: { some: { trainerId } } };
  const now = new Date();
  const upcomingClassWhere = {
    OR: [
      { createdById: trainerId },
      { course: { trainers: { some: { trainerId } } } },
      { cohort: { trainers: { some: { trainerId } } } },
    ],
    status: 'SCHEDULED',
    startsAt: { gte: now },
  };
  const [
    courses,
    cohorts,
    learnerCount,
    completedLessons,
    totalLessons,
    assessmentAttempts,
    upcomingLiveClassCount,
    upcomingLiveClasses,
  ] = await Promise.all([
    prisma.course.findMany({
      where: courseAccess,
      select: { id: true, title: true, description: true, status: true },
    }),
    prisma.cohort.findMany({
      where: cohortAccess,
      select: {
        id: true,
        name: true,
        status: true,
        programme: { select: { title: true } },
        _count: { select: { enrolments: true } },
      },
    }),
    prisma.user.count({
      where: {
        role: { name: 'STUDENT' },
        enrolments: { some: { cohort: cohortAccess } },
      },
    }),
    prisma.lessonProgress.count({
      where: { completed: true, lesson: { module: { course: courseAccess } } },
    }),
    prisma.lesson.count({ where: { module: { course: courseAccess } } }),
    prisma.assessmentAttempt.count({ where: { assessment: { course: courseAccess } } }),
    prisma.liveClass.count({ where: upcomingClassWhere }),
    prisma.liveClass.findMany({
      where: upcomingClassWhere,
      select: {
        id: true,
        title: true,
        startsAt: true,
        durationMins: true,
        course: { select: { title: true } },
        cohort: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
    }),
  ]);
  return ok(res, {
    courses,
    cohorts,
    metrics: {
      learnerCount,
      completedLessons,
      totalLessons,
      assessmentAttempts,
      upcomingLiveClassCount,
    },
    upcomingLiveClasses,
  });
};

export const studentDashboard = async (req, res) => {
  const studentId = req.user.id;
  const now = new Date();
  if (req.waitingProgramEnrollment) {
    const { intake, programme } = req.waitingProgramEnrollment.programOffering;
    return ok(res, {
      accessState: 'WAITING_FOR_INTAKE',
      serverNow: now,
      intake: {
        id: intake.id,
        gateNumber: intake.gateNumber,
        season: intake.season,
        year: intake.year,
        academicStartDate: req.waitingProgramEnrollment.programOffering.academicStartDate,
        timezone: intake.timezone,
        programmeTitle: programme.title,
      },
    });
  }
  const enrolments = await prisma.enrolment.findMany({
    where: { studentId, cohort: activeProgramCohortForStudent(studentId) },
    select: {
      id: true,
      cohort: {
        select: {
          name: true,
          courses: {
            where: { course: studentCourseAccessWhere(studentId, now) },
            select: {
              course: { select: { id: true, title: true, description: true, status: true } },
            },
          },
        },
      },
    },
  });
  const [attempts, notifications, assessmentCandidates, upcomingLiveClasses] = await Promise.all([
    prisma.assessmentAttempt.findMany({
      where: {
        studentId,
        assessment: {
          AND: [
            { course: studentCourseAccessWhere(studentId, now) },
            assessmentOfferingForStudentWhere(studentId),
          ],
        },
      },
      select: {
        id: true,
        startedAt: true,
        submittedAt: true,
        score: true,
        maxScore: true,
        status: true,
        resultsReleasedAt: true,
        assessment: {
          select: {
            title: true,
            type: true,
            resultsReleased: true,
            programOfferingId: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: 5,
    }),
    prisma.notification.findMany({
      where: {
        userId: studentId,
        read: false,
        ...studentNotificationAudienceWhere(req.activeProgramEnrollment),
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.assessment.findMany({
      where: {
        status: 'PUBLISHED',
        course: studentCourseAccessWhere(studentId, now),
        AND: [
          assessmentOfferingForStudentWhere(studentId),
          { OR: [{ availableFrom: null }, { availableFrom: { lte: now } }] },
          { OR: [{ availableTo: null }, { availableTo: { gte: now } }] },
        ],
      },
      select: {
        id: true,
        title: true,
        availableFrom: true,
        availableTo: true,
        attemptLimit: true,
        attempts: { where: { studentId }, select: { id: true } },
        course: { select: { title: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 5,
    }),
    prisma.liveClass.findMany({
      where: {
        status: 'SCHEDULED',
        startsAt: { gte: now },
        cohort: activeProgramCohortForStudent(studentId),
      },
      select: {
        id: true,
        title: true,
        startsAt: true,
        durationMins: true,
        course: { select: { title: true } },
        cohort: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
    }),
  ]);
  const upcomingAssessments = assessmentCandidates
    .filter((assessment) => assessment.attempts.length < assessment.attemptLimit)
    .slice(0, 5)
    .map(({ attempts: _attempts, ...assessment }) => assessment);
  const studentAttempts = attempts.map((attempt) => {
    const examinationResultsPending = attempt.assessment.type === 'EXAMINATION'
      && !attempt.assessment.resultsReleased
      && !attempt.resultsReleasedAt;
    return examinationResultsPending
      ? { ...attempt, score: null, maxScore: null, resultsPending: true }
      : { ...attempt, resultsPending: false };
  });
  return ok(res, {
    accessState: 'ELIGIBLE',
    enrolments,
    attempts: studentAttempts,
    notifications,
    upcomingAssessments,
    upcomingLiveClasses,
  });
};
