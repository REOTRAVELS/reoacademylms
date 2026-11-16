import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import slugify from '../utils/slugify.js';
import { canAccessCourse, canManageCourse, studentCourseAccessWhere } from '../utils/courseAccess.js';
import { getSubmissionAction, hideUnreleasedGrades } from '../utils/submissionPolicy.js';
import { isValidContentBlockArray, validateCourseQuality } from '../utils/courseQuality.js';
import { assessmentOfferingForStudentWhere } from '../utils/assessmentAccess.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';
import {
  assessmentCompletionFilter,
  countExaminationsAwaitingResults,
  getScoreableAssessmentIds,
} from '../utils/assessmentCompletion.js';

const courseVisibilities = new Set(['public', 'private', 'cohort']);
const prerequisiteModes = new Set(['none', 'recommended', 'required']);
const isValidDateInput = (value) => value === undefined || value === null || value === ''
  || (typeof value === 'string' && Number.isFinite(new Date(value).getTime()));
const serializeJsonSetting = (value) => {
  if (typeof value !== 'string') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false };
    return { value: JSON.stringify(value), valid: true };
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { valid: false };
    return { value, valid: true };
  } catch {
    return { valid: false };
  }
};

const loadBuilderCourse = (id, database = prisma, includeResourceAvailability = false) => database.course.findUnique({
  where: { id },
  include: {
    programme: true,
    modules: {
      orderBy: { position: 'asc' },
      include: {
        lessons: {
          orderBy: { position: 'asc' },
          include: {
            resources: {
              select: {
                id: true,
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                ...(includeResourceAvailability ? { storagePath: true } : {}),
              },
            },
          },
        },
      },
    },
    trainers: { include: { trainer: { select: { id: true, firstName: true, lastName: true, email: true, status: true } } } },
    cohorts: {
      include: {
        cohort: {
          select: {
            id: true,
            name: true,
            programmeId: true,
            intakeProgramOfferingId: true,
          },
        },
      },
    },
    resources: {
      select: {
        id: true,
        lessonId: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        ...(includeResourceAvailability ? { storagePath: true } : {}),
      },
    },
    assessments: {
      orderBy: { createdAt: 'asc' },
      include: {
        questions: { orderBy: { position: 'asc' } },
        programOffering: {
          select: {
            id: true,
            intake: { select: { gateNumber: true, season: true, year: true } },
          },
        },
      },
    },
  },
});

const getCourseBuilderRecord = async (id, user, database = prisma, includeResourceAvailability = false) => {
  const course = await loadBuilderCourse(id, database, includeResourceAvailability);
  if (!course) return { error: 'NOT_FOUND' };
  const canManage = user.role.name === 'SUPER_ADMIN' || (user.role.name === 'TRAINER'
    && await database.courseTrainer.findUnique({
      where: { courseId_trainerId: { courseId: course.id, trainerId: user.id } },
      select: { id: true },
    }));
  if (!canManage) return { error: 'FORBIDDEN' };
  return { course };
};

const validateLessonContent = async (content, courseId) => {
  if (typeof content !== 'string' || !isValidContentBlockArray(content)) {
    return 'Lesson content must be a JSON array of valid content blocks';
  }
  const blocks = JSON.parse(content);
  const resourceIds = [...new Set(blocks.map(({ resourceId }) => resourceId).filter(Boolean))];
  if (!resourceIds.length) return null;
  const resources = await prisma.resource.findMany({
    where: { id: { in: resourceIds }, courseId },
    select: { id: true },
  });
  if (resources.length !== resourceIds.length) return 'One or more selected resources do not belong to this course';
  return null;
};

export const listCourses = async (req, res) => {
  const where = {};
  if (req.query.programmeId) where.programmeId = req.query.programmeId;
  if (req.user.role.name === 'TRAINER') {
    where.trainers = { some: { trainerId: req.user.id } };
  } else if (req.user.role.name === 'STUDENT') {
    Object.assign(where, studentCourseAccessWhere(req.user.id));
  }
  const items = await prisma.course.findMany({
    where,
    include: { programme: true, _count: { select: { modules: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, items);
};

export const getCourse = async (req, res) => {
  const c = await prisma.course.findUnique({
    where: { id: req.params.id },
    include: {
      programme: true,
      modules: {
        orderBy: { position: 'asc' },
        include: {
          lessons: req.user.role.name === 'STUDENT'
            ? {
              orderBy: { position: 'asc' },
              select: {
                id: true,
                title: true,
                type: true,
                position: true,
                isPublished: true,
                estimatedDuration: true,
              },
            }
            : { orderBy: { position: 'asc' } },
        },
      },
      trainers: { include: { trainer: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      resources: { select: { id: true, lessonId: true, originalName: true, mimeType: true, sizeBytes: true } },
    },
  });
  if (!c) return fail(res, 'Not found', 404);
  if (!(await canAccessCourse(c.id, req.user))) return fail(res, 'Not found', 404);
  if (req.user.role.name === 'STUDENT' && c.status !== 'PUBLISHED') return fail(res, 'Not found', 404);
  if (req.user.role.name === 'STUDENT') {
    c.modules = c.modules.map((module) => ({
      ...module,
      lessons: module.lessons.filter((lesson) => lesson.isPublished),
    }));
    const lessonIds = c.modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
    const progress = await prisma.lessonProgress.findMany({
      where: { studentId: req.user.id, lessonId: { in: lessonIds }, completed: true },
      select: { lessonId: true },
    });
    const completedLessonIds = new Set(progress.map((item) => item.lessonId));
    c.modules = c.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        isCompleted: completedLessonIds.has(lesson.id),
      })),
    }));
    let completionRequirements = {};
    try {
      completionRequirements = JSON.parse(c.completionRequirements || '{}');
    } catch {
      completionRequirements = {};
    }
    const requiredLessonCompletionPercent = Number.isInteger(completionRequirements.minimumLessonCompletionPercent)
      && completionRequirements.minimumLessonCompletionPercent >= 1
      && completionRequirements.minimumLessonCompletionPercent <= 100
      ? completionRequirements.minimumLessonCompletionPercent
      : 100;
    const publishedLessons = c.modules.flatMap((module) => module.lessons);
    const completedLessons = publishedLessons.filter((lesson) => lesson.isCompleted).length;
    const lessonCompletionPercent = publishedLessons.length
      ? Math.round((completedLessons / publishedLessons.length) * 100)
      : 0;
    const requiredAssessments = completionRequirements.requireAssessment
      ? await prisma.assessment.findMany({
        where: {
          courseId: c.id,
          AND: [
            assessmentCompletionFilter,
            assessmentOfferingForStudentWhere(req.user.id),
          ],
        },
        select: { id: true, passMarkPercent: true, type: true, resultsReleased: true },
      })
      : [];
    const scoreableAssessmentIds = getScoreableAssessmentIds(requiredAssessments);
    const attempts = requiredAssessments.length
      ? await prisma.assessmentAttempt.findMany({
        where: {
          studentId: req.user.id,
          assessmentId: { in: scoreableAssessmentIds },
          submittedAt: { not: null },
          status: 'GRADED',
          score: { not: null },
          maxScore: { gt: 0 },
        },
        select: { assessmentId: true, score: true, maxScore: true },
      })
      : [];
    const passedAssessmentIds = new Set(attempts
      .filter((attempt) => (attempt.score / attempt.maxScore) * 100
        >= requiredAssessments.find(({ id }) => id === attempt.assessmentId).passMarkPercent)
      .map(({ assessmentId }) => assessmentId));
    c.completion = {
      completed: lessonCompletionPercent >= requiredLessonCompletionPercent
        && (!completionRequirements.requireAssessment
          || (requiredAssessments.length > 0 && passedAssessmentIds.size === requiredAssessments.length)),
      lessonCompletionPercent,
      requiredLessonCompletionPercent,
      completedLessons,
      totalLessons: publishedLessons.length,
      assessmentsPassed: passedAssessmentIds.size,
      requiredAssessments: requiredAssessments.length,
      assessmentsPendingResults: countExaminationsAwaitingResults(requiredAssessments),
    };
  }
  return ok(res, c);
};

export const getCourseQuality = async (req, res) => {
  const result = await getCourseBuilderRecord(req.params.id, req.user, prisma, true);
  if (result.error === 'NOT_FOUND') return fail(res, 'Not found', 404);
  if (result.error) return fail(res, 'You are not assigned to this course', 403);
  return ok(res, validateCourseQuality(result.course));
};

export const previewCourse = async (req, res) => {
  const result = await getCourseBuilderRecord(req.params.id, req.user);
  if (result.error === 'NOT_FOUND') return fail(res, 'Not found', 404);
  if (result.error) return fail(res, 'You are not assigned to this course', 403);
  return ok(res, result.course);
};

export const createCourse = async (req, res) => {
  const {
    title, subtitle, description, introduction, category, requirements, programmeId, status, trainerIds = [], cohortIds = [],
    difficulty = 'All Levels', language = 'English', estimatedDuration,
    courseCode, coverImage, thumbnail, learningObjectives = [], learningOutcomes = [],
    targetAudience, prerequisites, prerequisitesMode = 'none',
    startDate, endDate, visibility = 'public', completionRequirements = {}
  } = req.body || {};

  // Validate required fields
  if (typeof title !== 'string' || title.trim().length < 3) {
    return fail(res, 'Provide a title minimum 3 characters', 400);
  }
  if (title.trim().length > 120) {
    return fail(res, 'Title must be maximum 120 characters', 400);
  }
  if (status !== undefined && status !== 'DRAFT') {
    return fail(res, 'Courses must be created as drafts; use the publication workflow to change status', 400);
  }
  if (!Array.isArray(trainerIds) || !Array.isArray(cohortIds)) return fail(res, 'Trainer and cohort assignments must be lists', 400);
  if (visibility !== undefined && !courseVisibilities.has(visibility)) return fail(res, 'Select a valid course visibility', 400);
  if (!prerequisiteModes.has(prerequisitesMode)) return fail(res, 'Select a valid prerequisite mode', 400);
  if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
    return fail(res, 'Provide valid course dates', 400);
  }
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    return fail(res, 'The course end date must be after its start date', 400);
  }
  const completionSettings = serializeJsonSetting(completionRequirements);
  if (!completionSettings.valid) return fail(res, 'Completion requirements must be a valid JSON object', 400);
  if (req.user.role.name === 'TRAINER' && cohortIds.length) return fail(res, 'Only administrators can assign course cohorts', 403);
  if (programmeId !== undefined && programmeId !== null && programmeId !== ''
    && (typeof programmeId !== 'string' || !programmeId.trim())) {
    return fail(res, 'Select a valid Program', 400);
  }
  const resolvedProgrammeId = typeof programmeId === 'string' && programmeId.trim()
    ? programmeId.trim()
    : null;
  if (resolvedProgrammeId) {
    const programme = await prisma.programme.findUnique({
      where: { id: resolvedProgrammeId },
      select: { id: true },
    });
    if (!programme) return fail(res, 'Select a valid Program', 400);
    if (req.user.role.name === 'TRAINER') {
      const assignment = await prisma.cohortTrainer.findFirst({
        where: { trainerId: req.user.id, cohort: { programmeId: resolvedProgrammeId } },
        select: { id: true },
      });
      if (!assignment) return fail(res, 'You are not assigned to this Program', 403);
    }
  }
  if (cohortIds.length && new Set(cohortIds).size !== cohortIds.length) {
    return fail(res, 'Cohort assignments must not contain duplicates', 400);
  }

  const slug = await slugify(title.trim(), prisma.course);
  const data = {
    title: title.trim(),
    subtitle: subtitle || null,
    slug,
    description: description || null,
    introduction: introduction || null,
    category: category || null,
    requirements: requirements || null,
    programmeId: resolvedProgrammeId, status: 'DRAFT',
    difficulty, language, estimatedDuration: estimatedDuration || null,
    courseCode: courseCode || null, coverImage: coverImage || null,
    thumbnail: thumbnail || null,
    learningObjectives: typeof learningObjectives === 'string'
      ? learningObjectives
      : JSON.stringify(learningObjectives),
    learningOutcomes: typeof learningOutcomes === 'string'
      ? learningOutcomes
      : JSON.stringify(learningOutcomes),
    targetAudience: targetAudience || null,
    prerequisites: prerequisites || null,
    prerequisitesMode,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    visibility,
    completionRequirements: completionSettings.value,
  };

  if (req.user.role.name === 'TRAINER') {
    data.trainers = { create: { trainerId: req.user.id } };
  } else if (trainerIds.length) {
    const trainers = await prisma.user.findMany({
      where: { id: { in: trainerIds }, role: { name: 'TRAINER' }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (trainers.length !== new Set(trainerIds).size) {
      return fail(res, 'One or more selected trainers are invalid or inactive', 400);
    }
    data.trainers = { create: trainers.map(({ id }) => ({ trainerId: id })) };
  }
  if (cohortIds.length) {
    const cohorts = await prisma.cohort.findMany({
      where: { id: { in: cohortIds } },
      select: { id: true, programmeId: true },
    });
    if (cohorts.length !== new Set(cohortIds).size) return fail(res, 'One or more selected cohorts do not exist', 400);
    if (!resolvedProgrammeId || cohorts.some(({ programmeId: cohortProgrammeId }) => cohortProgrammeId !== resolvedProgrammeId)) {
      return fail(res, 'Every assigned cohort must belong to the selected Program', 400);
    }
    data.cohorts = { create: cohorts.map(({ id }) => ({ cohortId: id })) };
  }

  const c = await prisma.course.create({ data });
  await audit({ actorId: req.user.id, action: 'CREATE_COURSE', entity: 'Course', entityId: c.id, ipAddress: req.ip });
  return ok(res, c, 'Created', 201);
};

export const updateCourse = async (req, res) => {
  const existing = await prisma.course.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      status: true,
      startDate: true,
      endDate: true,
      programmeId: true,
      cohorts: { select: { cohortId: true } },
    },
  });
  if (!existing) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(existing.id, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const {
    title, subtitle, description, introduction, category, requirements, status, difficulty, language, estimatedDuration,
    courseCode, coverImage, thumbnail, learningObjectives, learningOutcomes,
    targetAudience, prerequisites, prerequisitesMode, startDate, endDate,
    visibility, completionRequirements, trainerIds, cohortIds, programmeId
  } = req.body || {};

  if (title !== undefined && (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120)) {
    return fail(res, 'Course title must be between 3 and 120 characters', 400);
  }
  if (status !== undefined) return fail(res, 'Change course status through the publication workflow', 400);
  if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
    return fail(res, 'Provide valid course dates', 400);
  }
  const parsedStartDate = startDate ? new Date(startDate) : null;
  const parsedEndDate = endDate ? new Date(endDate) : null;
  const effectiveStartDate = startDate === undefined ? existing.startDate : parsedStartDate;
  const effectiveEndDate = endDate === undefined ? existing.endDate : parsedEndDate;
  if (effectiveStartDate && effectiveEndDate && effectiveEndDate < effectiveStartDate) {
    return fail(res, 'The course end date must be after its start date', 400);
  }
  if (trainerIds !== undefined && !Array.isArray(trainerIds)) return fail(res, 'Trainer assignments must be a list', 400);
  if (cohortIds !== undefined && !Array.isArray(cohortIds)) return fail(res, 'Cohort assignments must be a list', 400);
  if (visibility !== undefined && !courseVisibilities.has(visibility)) return fail(res, 'Select a valid course visibility', 400);
  if (prerequisitesMode !== undefined && !prerequisiteModes.has(prerequisitesMode)) return fail(res, 'Select a valid prerequisite mode', 400);
  if (req.user.role.name === 'TRAINER' && (trainerIds !== undefined || cohortIds !== undefined)) {
    return fail(res, 'Only administrators can change trainer or cohort assignments', 403);
  }
  if (programmeId !== undefined && req.user.role.name !== 'SUPER_ADMIN') {
    return fail(res, 'Only administrators can change a course Program', 403);
  }
  if (programmeId !== undefined && programmeId !== null && programmeId !== ''
    && (typeof programmeId !== 'string' || !programmeId.trim())) {
    return fail(res, 'Select a valid Program', 400);
  }
  const resolvedProgrammeId = programmeId === undefined
    ? existing.programmeId
    : (typeof programmeId === 'string' && programmeId.trim() ? programmeId.trim() : null);
  if (programmeId !== undefined) {
    if (resolvedProgrammeId && !(await prisma.programme.findUnique({
      where: { id: resolvedProgrammeId },
      select: { id: true },
    }))) return fail(res, 'Select a valid Program', 400);
    if (resolvedProgrammeId !== existing.programmeId && existing.status !== 'DRAFT') {
      return fail(res, 'A Program cannot be changed after course publication; unpublish the course first', 409);
    }
    if (resolvedProgrammeId !== existing.programmeId && existing.cohorts.length && cohortIds === undefined) {
      return fail(res, 'Submit the matching cohort assignments when changing a course Program', 400);
    }
  }

  const data = {};
  if (title !== undefined) data.title = title.trim();
  if (subtitle !== undefined) data.subtitle = subtitle || null;
  if (description !== undefined) data.description = description;
  if (introduction !== undefined) data.introduction = introduction || null;
  if (category !== undefined) data.category = category || null;
  if (requirements !== undefined) data.requirements = requirements || null;
  if (difficulty) data.difficulty = difficulty;
  if (language) data.language = language;
  if (estimatedDuration !== undefined) data.estimatedDuration = estimatedDuration;
  if (courseCode !== undefined) data.courseCode = courseCode || null;
  if (coverImage !== undefined) data.coverImage = coverImage;
  if (thumbnail !== undefined) data.thumbnail = thumbnail;
  if (learningObjectives !== undefined) data.learningObjectives = typeof learningObjectives === 'string'
    ? learningObjectives
    : JSON.stringify(learningObjectives);
  if (learningOutcomes !== undefined) data.learningOutcomes = typeof learningOutcomes === 'string'
    ? learningOutcomes
    : JSON.stringify(learningOutcomes);
  if (targetAudience !== undefined) data.targetAudience = targetAudience;
  if (prerequisites !== undefined) data.prerequisites = prerequisites;
  if (prerequisitesMode) data.prerequisitesMode = prerequisitesMode;
  if (startDate !== undefined) data.startDate = parsedStartDate;
  if (endDate !== undefined) data.endDate = parsedEndDate;
  if (visibility) data.visibility = visibility;
  if (programmeId !== undefined) data.programmeId = resolvedProgrammeId;
  if (completionRequirements !== undefined) {
    const serialized = serializeJsonSetting(completionRequirements);
    if (!serialized.valid) return fail(res, 'Completion requirements must be a valid JSON object', 400);
    data.completionRequirements = serialized.value;
  }

  if (trainerIds !== undefined) {
    const trainers = await prisma.user.findMany({
      where: { id: { in: trainerIds }, role: { name: 'TRAINER' }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (trainers.length !== new Set(trainerIds).size) {
      return fail(res, 'One or more selected trainers are invalid or inactive', 400);
    }
    data.trainers = {
      deleteMany: {},
      ...(trainers.length ? { create: trainers.map(({ id }) => ({ trainerId: id })) } : {}),
    };
  }
  if (cohortIds !== undefined) {
    if (new Set(cohortIds).size !== cohortIds.length) {
      return fail(res, 'Cohort assignments must not contain duplicates', 400);
    }
    const cohorts = await prisma.cohort.findMany({
      where: { id: { in: cohortIds } },
      select: { id: true, programmeId: true },
    });
    if (cohorts.length !== new Set(cohortIds).size) return fail(res, 'One or more selected cohorts do not exist', 400);
    if (cohorts.some(({ programmeId: cohortProgrammeId }) => cohortProgrammeId !== resolvedProgrammeId)) {
      return fail(res, 'Every assigned cohort must belong to the course Program', 400);
    }
    const requestedIds = new Set(cohortIds);
    const removedIds = (existing.cohorts || [])
      .map(({ cohortId }) => cohortId)
      .filter((cohortId) => !requestedIds.has(cohortId));
    if (removedIds.length) {
      const enrolledStudents = await prisma.enrolment.count({ where: { cohortId: { in: removedIds } } });
      if (enrolledStudents) {
        return fail(res, 'Cohorts with enrolled students cannot be removed from this course', 409);
      }
    }
    data.cohorts = {
      deleteMany: {},
      ...(cohorts.length ? { create: cohorts.map(({ id }) => ({ cohortId: id })) } : {}),
    };
  }
  const c = await prisma.course.update({ where: { id: req.params.id }, data });
  await audit({ actorId: req.user.id, action: 'UPDATE_COURSE', entity: 'Course', entityId: c.id, ipAddress: req.ip });
  await revalidateLiveClassAccess();
  return ok(res, c, 'Updated');
};

export const deleteCourse = async (req, res) => {
  const course = await prisma.course.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!course) return fail(res, 'Not found', 404);
  if (course.status !== 'DRAFT') return fail(res, 'Only draft courses can be deleted; archive published courses instead', 409);
  const [enrolments, progress, attempts, submissions, discussions] = await Promise.all([
    prisma.enrolment.count({ where: { cohort: { courses: { some: { courseId: course.id } } } } }),
    prisma.lessonProgress.count({ where: { lesson: { module: { courseId: course.id } } } }),
    prisma.assessmentAttempt.count({ where: { assessment: { courseId: course.id } } }),
    prisma.submission.count({ where: { assignment: { courseId: course.id } } }),
    prisma.courseDiscussionPost.count({ where: { courseId: course.id } }),
  ]);
  if (enrolments || progress || attempts || submissions || discussions) {
    return fail(res, 'This course has learner or discussion history and cannot be deleted. Archive it to preserve history.', 409);
  }
  await prisma.course.delete({ where: { id: req.params.id } });
  return ok(res, null, 'Deleted');
};

export const publishCourse = async (req, res) => {
  let publication;
  try {
    publication = await prisma.$transaction(async (database) => {
      const result = await getCourseBuilderRecord(req.params.id, req.user, database, true);
      if (result.error) return result;
      if (result.course.status === 'ARCHIVED') return { error: 'ARCHIVED' };
      const quality = validateCourseQuality(result.course);
      if (!quality.valid) return { error: 'QUALITY', quality };
      const course = await database.course.update({
        where: { id: result.course.id },
        data: { status: 'PUBLISHED' },
      });
      return { course, quality };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error?.code === 'P2034') {
      return fail(res, 'The course changed while publication was being validated. Review the latest course state and try again.', 409, {
        code: 'course_changed_during_validation',
        severity: 'ERROR',
        entityType: 'Course',
        entityId: req.params.id,
        step: 7,
        guidance: 'Run the quality check again after the latest course changes are saved.',
      });
    }
    throw error;
  }
  if (publication.error === 'NOT_FOUND') return fail(res, 'Not found', 404);
  if (publication.error === 'FORBIDDEN') return fail(res, 'You are not assigned to this course', 403);
  if (publication.error === 'ARCHIVED') return fail(res, 'Archived courses cannot be published', 409);
  if (publication.error === 'QUALITY') return fail(res, 'Course has blocking quality issues', 422, publication.quality);
  const { course, quality } = publication;
  await audit({ actorId: req.user.id, action: 'PUBLISH_COURSE', entity: 'Course', entityId: course.id, ipAddress: req.ip });
  return ok(res, { course, quality }, 'Published');
};

export const unpublishCourse = async (req, res) => {
  const result = await getCourseBuilderRecord(req.params.id, req.user);
  if (result.error === 'NOT_FOUND') return fail(res, 'Not found', 404);
  if (result.error) return fail(res, 'You are not assigned to this course', 403);
  if (result.course.status !== 'PUBLISHED') return fail(res, 'Only published courses can be unpublished', 409);
  const course = await prisma.course.update({ where: { id: result.course.id }, data: { status: 'DRAFT' } });
  await audit({ actorId: req.user.id, action: 'UNPUBLISH_COURSE', entity: 'Course', entityId: course.id, ipAddress: req.ip });
  return ok(res, course, 'Unpublished');
};

export const archiveCourse = async (req, res) => {
  const result = await getCourseBuilderRecord(req.params.id, req.user);
  if (result.error === 'NOT_FOUND') return fail(res, 'Not found', 404);
  if (result.error) return fail(res, 'You are not assigned to this course', 403);
  if (result.course.status === 'ARCHIVED') return ok(res, result.course, 'Already archived');
  const course = await prisma.course.update({ where: { id: result.course.id }, data: { status: 'ARCHIVED' } });
  await audit({ actorId: req.user.id, action: 'ARCHIVE_COURSE', entity: 'Course', entityId: course.id, ipAddress: req.ip });
  return ok(res, course, 'Archived');
};

export const reorderModules = async (req, res) => {
  const { moduleIds } = req.body || {};
  const course = await prisma.course.findUnique({
    where: { id: req.params.id },
    select: { id: true, modules: { select: { id: true } } },
  });
  if (!course) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(course.id, req.user))) return fail(res, 'You are not assigned to this course', 403);
  if (!Array.isArray(moduleIds) || new Set(moduleIds).size !== moduleIds.length
    || moduleIds.length !== course.modules.length
    || !moduleIds.every((id) => course.modules.some((module) => module.id === id))) {
    return fail(res, 'Provide every course module exactly once in the requested order', 400);
  }
  await prisma.$transaction(moduleIds.map((id, position) => prisma.module.update({ where: { id }, data: { position } })));
  return ok(res, { moduleIds }, 'Modules reordered');
};

export const reorderLessons = async (req, res) => {
  const module = await prisma.module.findUnique({
    where: { id: req.params.moduleId },
    select: { id: true, courseId: true, lessons: { select: { id: true } } },
  });
  if (!module) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(module.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const { lessonIds } = req.body || {};
  if (!Array.isArray(lessonIds) || new Set(lessonIds).size !== lessonIds.length
    || lessonIds.length !== module.lessons.length
    || !lessonIds.every((id) => module.lessons.some((lesson) => lesson.id === id))) {
    return fail(res, 'Provide every module lesson exactly once in the requested order', 400);
  }
  await prisma.$transaction(lessonIds.map((id, position) => prisma.lesson.update({ where: { id }, data: { position } })));
  return ok(res, { lessonIds }, 'Lessons reordered');
};

export const createModule = async (req, res) => {
  if (!(await canManageCourse(req.params.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const { title, description } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) return fail(res, 'Module title is required', 400);
  const count = await prisma.module.count({ where: { courseId: req.params.courseId } });
  const m = await prisma.module.create({ data: { courseId: req.params.courseId, title: title.trim(), description, position: count } });
  return ok(res, m, 'Created', 201);
};

export const updateModule = async (req, res) => {
  const existing = await prisma.module.findUnique({ where: { id: req.params.id }, select: { courseId: true } });
  if (!existing) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(existing.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const { title, description, position } = req.body || {};
  const data = {};
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return fail(res, 'Module title is required', 400);
  if (title !== undefined) data.title = title.trim();
  if (description !== undefined) data.description = description;
  if (position !== undefined) {
    if (!Number.isInteger(position) || position < 0) return fail(res, 'Module position must be a non-negative integer', 400);
    data.position = position;
  }
  const m = await prisma.module.update({ where: { id: req.params.id }, data });
  return ok(res, m, 'Updated');
};

export const deleteModule = async (req, res) => {
  const existing = await prisma.module.findUnique({
    where: { id: req.params.id },
    select: { courseId: true, lessons: { select: { id: true } } },
  });
  if (!existing) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(existing.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const lessonIds = existing.lessons.map(({ id }) => id);
  const progressCount = lessonIds.length
    ? await prisma.lessonProgress.count({ where: { lessonId: { in: lessonIds } } })
    : 0;
  if (progressCount) return fail(res, 'This module contains learner progress and cannot be deleted', 409);
  await prisma.module.delete({ where: { id: req.params.id } });
  return ok(res, null, 'Deleted');
};

export const createLesson = async (req, res) => {
  const { title, type, content, videoUrl, isPublished, objectives, outcomes, estimatedDuration } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) return fail(res, 'Lesson title is required', 400);
  const module = await prisma.module.findUnique({
    where: { id: req.params.moduleId },
    select: { id: true, courseId: true },
  });
  if (!module) return fail(res, 'Module not found', 404);
  if (!(await canManageCourse(module.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  if (content !== undefined && content !== null) {
    const contentError = await validateLessonContent(content, module.courseId);
    if (contentError) return fail(res, contentError, 400);
  }
  const position = await prisma.lesson.count({ where: { moduleId: module.id } });
  const lesson = await prisma.lesson.create({
    data: {
      moduleId: module.id,
      title: title.trim(),
      type: type || 'TEXT',
      content: content || null, // Stores structured content blocks as JSON
      videoUrl,
      isPublished: Boolean(isPublished),
      position,
      objectives: objectives !== undefined ? JSON.stringify(objectives) : null,
      outcomes: outcomes !== undefined ? JSON.stringify(outcomes) : null,
      estimatedDuration,
    },
  });
  return ok(res, lesson, 'Created', 201);
};

export const createAssignment = async (req, res) => {
  if (!(await canManageCourse(req.params.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const { lessonId, title, description, instructions, maxScore, dueDate, status } = req.body || {};
  const assignment = await prisma.assignment.create({
    data: {
      courseId: req.params.courseId,
      lessonId,
      title,
      description,
      instructions,
      maxScore: maxScore ? Number(maxScore) : 100,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: status || 'DRAFT',
    },
  });
  await audit({ actorId: req.user.id, action: 'CREATE_ASSIGNMENT', entity: 'Assignment', entityId: assignment.id, ipAddress: req.ip });
  return ok(res, assignment, 'Created', 201);
};
export const listAssignments = async (req, res) => {
  const where = {};
  if (req.query.courseId) where.courseId = req.query.courseId;
  if (req.query.lessonId) where.lessonId = req.query.lessonId;
  if (req.user.role.name === 'TRAINER') {
    where.course = { trainers: { some: { trainerId: req.user.id } } };
  } else if (req.user.role.name === 'STUDENT') {
    where.status = 'PUBLISHED';
    where.course = studentCourseAccessWhere(req.user.id);
  }
  const assignments = await prisma.assignment.findMany({
    where,
    include: {
      submissions: {
        where: req.user.role.name === 'STUDENT' ? { studentId: req.user.id } : undefined,
        include: {
          grade: true,
          student: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { submittedAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, assignments.map((assignment) => ({
    ...assignment,
    submissions: req.user.role.name === 'STUDENT' ? hideUnreleasedGrades(assignment.submissions) : assignment.submissions,
  })));
};

export const getAssignment = async (req, res) => {
  const assignment = await prisma.assignment.findUnique({
    where: { id: req.params.id },
    include: {
      course: { select: { trainers: { select: { trainerId: true } } } },
      submissions: {
        where: req.user.role.name === 'STUDENT' ? { studentId: req.user.id } : undefined,
        include: { student: { select: { id: true, firstName: true, lastName: true, email: true } }, grade: true },
      },
    },
  });
  if (!assignment) return fail(res, 'Not found', 404);
  if (req.user.role.name === 'STUDENT') {
    if (!assignment.courseId || assignment.status !== 'PUBLISHED' || !(await canAccessCourse(assignment.courseId, req.user))) {
      return fail(res, 'Not found', 404);
    }
  } else if (req.user.role.name === 'TRAINER' && !(await canManageCourse(assignment.courseId, req.user))) {
    return fail(res, 'You are not assigned to this course', 403);
  }
  const { course, ...result } = assignment;
  if (req.user.role.name === 'STUDENT') result.submissions = hideUnreleasedGrades(result.submissions);
  return ok(res, result);
};

export const submitAssignment = async (req, res) => {
  const assignmentId = req.params.id;
  const { content, fileUrl } = req.body || {};
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) return fail(res, 'Not found', 404);
  if (assignment.status !== 'PUBLISHED' || !assignment.courseId || !(await canAccessCourse(assignment.courseId, req.user))) {
    return fail(res, 'Assignment not available for your account', 403);
  }
  if (assignment.dueDate && assignment.dueDate < new Date()) return fail(res, 'Assignment deadline has passed', 403);
  if ((!content || typeof content !== 'string' || !content.trim()) && !fileUrl) return fail(res, 'Submit text or attach a file', 400);
  if (assignment.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: assignment.lessonId },
      select: { module: { select: { courseId: true } } },
    });
    if (!lesson || lesson.module.courseId !== assignment.courseId) return fail(res, 'Assignment lesson does not belong to this course', 400);
  }

  const existing = await prisma.submission.findFirst({
    where: { studentId: req.user.id, assignmentId },
    include: { grade: true },
  });
  const action = getSubmissionAction(existing);
  if (action === 'reject') return fail(res, 'This submission has already been graded', 409);
  const submission = action === 'update'
    ? await prisma.submission.update({
      where: { id: existing.id },
      data: { content: content?.trim() || null, fileUrl: fileUrl || null, status: 'SUBMITTED' },
    })
    : await prisma.submission.create({
      data: { studentId: req.user.id, assignmentId, content: content?.trim() || null, fileUrl: fileUrl || null, status: 'SUBMITTED' },
    });
  await audit({ actorId: req.user.id, action: 'SUBMIT_ASSIGNMENT', entity: 'Submission', entityId: submission.id, ipAddress: req.ip });
  return ok(res, submission, existing ? 'Submission updated' : 'Submitted', existing ? 200 : 201);
};

export const gradeAssignment = async (req, res) => {
  const submissionId = req.params.submissionId;
  const { score, feedback } = req.body || {};
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { assignment: { select: { courseId: true, maxScore: true } } },
  });
  if (!submission) return fail(res, 'Not found', 404);
  if (!submission.assignment?.courseId) return fail(res, 'Assignment not found', 404);
  if (!(await canManageCourse(submission.assignment.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);

  const numericScore = Number(score);
  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > submission.assignment.maxScore) {
    return fail(res, `Score must be between 0 and ${submission.assignment.maxScore}`, 400);
  }

  const graded = await prisma.grade.upsert({
    where: { submissionId },
    create: {
      submissionId,
      gradedById: req.user.id,
      score: numericScore,
      feedback: feedback ?? null,
      released: false,
    },
    update: {
      gradedById: req.user.id,
      score: numericScore,
      feedback: feedback ?? null,
      released: false,
    },
  });

  await prisma.submission.update({
    where: { id: submissionId },
    data: { status: 'GRADED' },
  });

  await audit({ actorId: req.user.id, action: 'GRADE_ASSIGNMENT', entity: 'Submission', entityId: submissionId, ipAddress: req.ip });
  return ok(res, { gradeId: graded.id, score: numericScore, feedback: feedback ?? null, released: false }, 'Graded', 200);
};

export const releaseAssignmentGrade = async (req, res) => {
  const submission = await prisma.submission.findUnique({
    where: { id: req.params.submissionId },
    include: { assignment: { select: { courseId: true } }, grade: true },
  });
  if (!submission?.assignment?.courseId || !submission.grade) return fail(res, 'Graded submission not found', 404);
  if (!(await canManageCourse(submission.assignment.courseId, req.user))) {
    return fail(res, 'You are not assigned to this course', 403);
  }
  const grade = await prisma.grade.update({
    where: { submissionId: submission.id },
    data: { released: true },
  });
  await audit({ actorId: req.user.id, action: 'RELEASE_ASSIGNMENT_GRADE', entity: 'Submission', entityId: submission.id, ipAddress: req.ip });
  return ok(res, grade, 'Grade released');
};

export const getLesson = async (req, res) => {
  const l = await prisma.lesson.findUnique({
    where: { id: req.params.id },
    include: {
      module: { select: { id: true, title: true, courseId: true, course: { select: { id: true, title: true, status: true } } } },
      resources: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } },
    },
  });
  if (!l) return fail(res, 'Not found', 404);
  if (!(await canAccessCourse(l.module.courseId, req.user))) return fail(res, 'Not found', 404);
  if (req.user.role.name === 'STUDENT') {
    if (l.module.course.status !== 'PUBLISHED' || !l.isPublished) return fail(res, 'Not found', 404);
    const progress = await prisma.lessonProgress.findUnique({
      where: { studentId_lessonId: { studentId: req.user.id, lessonId: l.id } },
      select: { completed: true, completedAt: true },
    });
    return ok(res, { ...l, progress });
  }
  return ok(res, l);
};

export const updateLesson = async (req, res) => {
  const existing = await prisma.lesson.findUnique({
    where: { id: req.params.id },
    select: { module: { select: { courseId: true } } },
  });
  if (!existing) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(existing.module.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const {
    title, type, content, videoUrl, isPublished, position,
    objectives, outcomes, estimatedDuration
  } = req.body || {};
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return fail(res, 'Lesson title is required', 400);
  if (isPublished !== undefined && typeof isPublished !== 'boolean') return fail(res, 'Lesson publication setting must be true or false', 400);
  if (position !== undefined && (!Number.isInteger(position) || position < 0)) return fail(res, 'Lesson position must be a non-negative integer', 400);
  
  if (content !== undefined && content !== null) {
    const contentError = await validateLessonContent(content, existing.module.courseId);
    if (contentError) return fail(res, contentError, 400);
  }
  
  const data = {};
  if (title !== undefined) data.title = title.trim();
  if (type) data.type = type;
  if (content !== undefined) data.content = content || null; // Stores structured content blocks as JSON
  if (videoUrl !== undefined) data.videoUrl = videoUrl;
  if (isPublished !== undefined) data.isPublished = isPublished;
  if (position !== undefined) data.position = position;
  if (objectives !== undefined) data.objectives = objectives !== undefined ? JSON.stringify(objectives) : null;
  if (outcomes !== undefined) data.outcomes = outcomes !== undefined ? JSON.stringify(outcomes) : null;
  if (estimatedDuration !== undefined) data.estimatedDuration = estimatedDuration;
  const l = await prisma.lesson.update({ where: { id: req.params.id }, data });
  return ok(res, l, 'Updated');
};

export const deleteLesson = async (req, res) => {
  const existing = await prisma.lesson.findUnique({
    where: { id: req.params.id },
    select: { module: { select: { courseId: true } } },
  });
  if (!existing) return fail(res, 'Not found', 404);
  if (!(await canManageCourse(existing.module.courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const progressCount = await prisma.lessonProgress.count({ where: { lessonId: req.params.id } });
  if (progressCount) return fail(res, 'This lesson has learner progress and cannot be deleted', 409);
  await prisma.lesson.delete({ where: { id: req.params.id } });
  return ok(res, null, 'Deleted');
};