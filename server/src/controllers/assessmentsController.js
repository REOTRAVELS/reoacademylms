import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { canAccessCourse, canManageCourse, studentCourseAccessWhere } from '../utils/courseAccess.js';
import { isAssessmentOpen, isAttemptWithinTimeLimit } from '../utils/assessmentAvailability.js';
import { getAttemptView } from '../utils/assessmentAttemptView.js';
import { scoreAssessmentAttempt } from '../utils/assessmentScoring.js';
import {
  assessmentOfferingForStudentWhere,
  canAccessAssessmentOffering,
} from '../utils/assessmentAccess.js';

const canManageAssessment = async (assessmentId, user) => {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      courseId: true,
      availableFrom: true,
      availableTo: true,
      status: true,
      type: true,
      resultsReleased: true,
      programOfferingId: true,
    },
  });
  if (!assessment) return null;
  if (!(await canManageCourse(assessment.courseId, user))) return false;
  return assessment;
};

const assessmentStatuses = new Set(['DRAFT', 'PUBLISHED', 'CLOSED']);
const assessmentTypes = new Set(['ASSESSMENT', 'EXAMINATION']);
const questionTypes = new Set(['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER', 'TRUE_FALSE', 'SHORT_ANSWER']);
const validDate = (value) => value === undefined || value === null || value === ''
  || (typeof value === 'string' && Number.isFinite(new Date(value).getTime()));

const validateProgramOffering = async (courseId, programOfferingId) => {
  if (programOfferingId === undefined || programOfferingId === null || programOfferingId === '') {
    return { programOfferingId: null };
  }
  if (typeof programOfferingId !== 'string' || !programOfferingId.trim()) {
    return { error: 'Select a valid Program Offering' };
  }
  const [course, offering] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      select: { programmeId: true },
    }),
    prisma.intakeProgramOffering.findUnique({
      where: { id: programOfferingId },
      select: { id: true, programmeId: true },
    }),
  ]);
  if (!course) return { error: 'Course not found' };
  if (!offering || !course.programmeId || offering.programmeId !== course.programmeId) {
    return { error: 'Choose a Program Offering that belongs to this course’s Program' };
  }
  return { programOfferingId: offering.id };
};

const assessmentOfferingMatchesStudent = (assessment, studentId) => (
  canAccessAssessmentOffering(assessment, studentId)
);

const validateAssessmentSettings = ({
  title, timeLimitMin, attemptLimit, passMarkPercent, status, type, availableFrom, availableTo,
}) => {
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return 'Assessment title is required';
  if (type !== undefined && !assessmentTypes.has(type)) return 'Select a valid assessment type';
  if (timeLimitMin !== undefined && timeLimitMin !== null && timeLimitMin !== ''
    && (!Number.isInteger(Number(timeLimitMin)) || Number(timeLimitMin) < 1)) return 'Time limit must be a positive number of minutes';
  if (attemptLimit !== undefined && (!Number.isInteger(Number(attemptLimit)) || Number(attemptLimit) < 1)) {
    return 'Attempt limit must be a positive integer';
  }
  if (passMarkPercent !== undefined
    && (!Number.isFinite(Number(passMarkPercent)) || Number(passMarkPercent) < 0 || Number(passMarkPercent) > 100)) {
    return 'Pass mark must be between 0 and 100 percent';
  }
  if (status !== undefined && !assessmentStatuses.has(status)) return 'Select a valid assessment status';
  if (!validDate(availableFrom) || !validDate(availableTo)) return 'Provide valid assessment availability dates';
  if (availableFrom && availableTo && new Date(availableTo) < new Date(availableFrom)) {
    return 'Assessment end date must be after its start date';
  }
  return null;
};

const validateQuestion = ({ type, prompt, points, options, correctAnswer }) => {
  if (!questionTypes.has(type)) return 'Select a valid question type';
  if (typeof prompt !== 'string' || !prompt.trim()) return 'Question prompt is required';
  if (points !== undefined && (!Number.isInteger(Number(points)) || Number(points) < 1)) return 'Question points must be a positive integer';
  if (['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(type)) {
    if (!Array.isArray(options) || options.length < 2) return 'Multiple-choice questions need at least two options';
    const emptyCorrectAnswer = correctAnswer === undefined || correctAnswer === null || correctAnswer === ''
      || (Array.isArray(correctAnswer) && correctAnswer.length === 0);
    if (emptyCorrectAnswer) return 'Provide at least one correct answer';
    if (type === 'MULTIPLE_CHOICE' && Array.isArray(correctAnswer) && correctAnswer.length !== 1) {
      return 'Multiple-choice questions must have exactly one correct answer';
    }
    const correctAnswers = Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer];
    if (correctAnswers.some((answer) => !options.includes(answer))) return 'Correct answers must match the available options';
  }
  if (type === 'TRUE_FALSE' && !['True', 'False', true, false].includes(correctAnswer)) {
    return 'True/false questions need a correct answer';
  }
  return null;
};

const finalizeAttempt = async (attempt, submittedAt = new Date(), manualGrades = []) => {
  const finalized = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.assessmentAttempt.updateMany({
      where: { id: attempt.id, submittedAt: null },
      data: { submittedAt, status: 'SUBMITTED' },
    });
    if (!claimed.count) return false;
    const currentAttempt = await transaction.assessmentAttempt.findUnique({
      where: { id: attempt.id },
      include: { assessment: { include: { questions: true } }, answers: true },
    });
    if (!currentAttempt) throw new Error('Assessment attempt disappeared during finalization');
    const result = scoreAssessmentAttempt(currentAttempt, manualGrades);
    for (const answer of result.answerUpdates) {
      await transaction.assessmentAnswer.update({
        where: { id: answer.answerId },
        data: { points: answer.points, feedback: answer.feedback, isCorrect: answer.isCorrect },
      });
    }
    await transaction.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedAt,
        score: result.score,
        maxScore: result.maxScore,
        status: result.status,
      },
    });
    return {
      ...currentAttempt,
      submittedAt,
      score: result.score,
      maxScore: result.maxScore,
      status: result.status,
      answers: currentAttempt.answers.map((answer) => {
        const update = result.answerUpdates.find((item) => item.answerId === answer.id);
        return update ? { ...answer, ...update } : answer;
      }),
    };
  });

  if (!finalized) return null;
  await audit({ actorId: attempt.studentId, action: 'SUBMIT_ASSESSMENT', entity: 'AssessmentAttempt', entityId: attempt.id });
  return finalized;
};

export const listAssessments = async (req, res) => {
  const where = {};
  if (req.query.courseId) where.courseId = req.query.courseId;
  if (req.user.role.name === 'TRAINER') {
    where.course = { trainers: { some: { trainerId: req.user.id } } };
  } else if (req.user.role.name === 'STUDENT') {
    where.status = 'PUBLISHED';
    where.AND = [
      { course: studentCourseAccessWhere(req.user.id) },
      assessmentOfferingForStudentWhere(req.user.id),
    ];
  }
  const items = await prisma.assessment.findMany({
    where,
    include: {
      programOffering: {
        select: {
          id: true,
          intake: { select: { gateNumber: true, season: true, year: true } },
          programme: { select: { title: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, items);
};

export const getAssessment = async (req, res) => {
  const a = await prisma.assessment.findUnique({
    where: { id: req.params.id },
    include: {
      questions: { orderBy: { position: 'asc' } },
      programOffering: {
        select: {
          id: true,
          intake: { select: { gateNumber: true, season: true, year: true } },
          programme: { select: { title: true } },
        },
      },
    },
  });
  if (!a) return fail(res, 'Not found', 404);
  if (req.user.role.name === 'STUDENT') {
    if (a.status !== 'PUBLISHED'
      || !(await canAccessCourse(a.courseId, req.user))
      || !(await assessmentOfferingMatchesStudent(a, req.user.id))) return fail(res, 'Not found', 404);
    if (!isAssessmentOpen(a)) return fail(res, 'Assessment is not currently available', 403);
  } else if (req.user.role.name === 'TRAINER' && !(await canManageCourse(a.courseId, req.user))) {
    return fail(res, 'You are not assigned to this course', 403);
  }
  const isPrivileged = ['SUPER_ADMIN', 'TRAINER'].includes(req.user.role.name);
  const questions = a.questions.map((q) => {
    if (isPrivileged) return q;
    const { correctAnswer, ...rest } = q;
    return rest;
  });
  return ok(res, { ...a, questions });
};

export const createAssessment = async (req, res) => {
  const {
    courseId, title, description, instructions, timeLimitMin, attemptLimit,
    passMarkPercent = 50, status, type = 'ASSESSMENT', availableFrom, availableTo,
    programOfferingId,
  } = req.body || {};
 if (typeof title !== 'string' || !title.trim()) return fail(res, 'Assessment title is required', 400);
  if (status !== undefined && status !== 'DRAFT') return fail(res, 'Create assessments as drafts, then configure and publish them', 400);
  const validationError = validateAssessmentSettings({
    title, timeLimitMin, attemptLimit, passMarkPercent, status, type, availableFrom, availableTo,
  });
  if (validationError) return fail(res, validationError, 400);
  if (!(await canManageCourse(courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  const offeringValidation = await validateProgramOffering(courseId, programOfferingId);
  if (offeringValidation.error) return fail(res, offeringValidation.error, 400);
  const a = await prisma.assessment.create({
    data: {
      courseId, title: title.trim(), description, instructions: instructions || null,
      programOfferingId: offeringValidation.programOfferingId,
      type,
      timeLimitMin: timeLimitMin ? Number(timeLimitMin) : null,
      attemptLimit: attemptLimit ? Number(attemptLimit) : 1,
      passMarkPercent: Number(passMarkPercent),
      status: status || 'DRAFT',
      availableFrom: availableFrom ? new Date(availableFrom) : null,
      availableTo: availableTo ? new Date(availableTo) : null,
    },
  });
  await audit({ actorId: req.user.id, action: 'CREATE_ASSESSMENT', entity: 'Assessment', entityId: a.id, ipAddress: req.ip });
  return ok(res, a, 'Created', 201);
};

export const updateAssessment = async (req, res) => {
  const assessment = await canManageAssessment(req.params.id, req.user);
  if (assessment === null) return fail(res, 'Not found', 404);
  if (!assessment) return fail(res, 'You are not assigned to this course', 403);
  const {
    title, description, instructions, timeLimitMin, attemptLimit, passMarkPercent,
    status, type, resultsReleased, availableFrom, availableTo, programOfferingId,
  } = req.body || {};
  if (resultsReleased !== undefined && typeof resultsReleased !== 'boolean') {
    return fail(res, 'Examination result release must be true or false', 400);
  }
  if (resultsReleased !== undefined && req.user.role.name !== 'SUPER_ADMIN') {
    return fail(res, 'Only an administrator can release examination results', 403);
  }
  const validationError = validateAssessmentSettings({
    title, timeLimitMin, attemptLimit, passMarkPercent, status, type, availableFrom, availableTo,
  });
  if (validationError) return fail(res, validationError, 400);
  const effectiveAvailableFrom = availableFrom === undefined
    ? assessment.availableFrom
    : (availableFrom ? new Date(availableFrom) : null);
  const effectiveAvailableTo = availableTo === undefined
    ? assessment.availableTo
    : (availableTo ? new Date(availableTo) : null);
  if (effectiveAvailableFrom && effectiveAvailableTo && effectiveAvailableTo < effectiveAvailableFrom) {
    return fail(res, 'Assessment end date must be after its start date', 400);
  }
  const attempts = await prisma.assessmentAttempt.count({ where: { assessmentId: req.params.id } });
  const offeringValidation = programOfferingId === undefined
    ? null
    : await validateProgramOffering(assessment.courseId, programOfferingId);
  if (offeringValidation?.error) return fail(res, offeringValidation.error, 400);
  const changesAttemptSettings = [
    title, description, instructions, timeLimitMin, attemptLimit, passMarkPercent, type,
    availableFrom, availableTo, programOfferingId,
  ].some((value) => value !== undefined);
  if (attempts && changesAttemptSettings) {
    return fail(res, 'Assessment settings cannot be changed after learners have started attempts', 409);
  }
  if (attempts && status !== undefined && status !== assessment.status && status !== 'CLOSED') {
    return fail(res, 'An assessment with learner attempts can only be closed', 409);
  }
  const effectiveType = type ?? assessment.type ?? 'ASSESSMENT';
  if (resultsReleased !== undefined && effectiveType !== 'EXAMINATION') {
    return fail(res, 'Only examination results can be released', 400);
  }
  if (resultsReleased === true && !assessment.resultsReleased) {
    if (assessment.status !== 'CLOSED') {
      return fail(res, 'Close the examination before releasing results', 409);
    }
    const pendingAttempts = await prisma.assessmentAttempt.count({
      where: { assessmentId: req.params.id, status: { not: 'GRADED' } },
    });
    if (pendingAttempts) return fail(res, 'Submit and grade all examination attempts before releasing results', 409);
  }
  if (status === 'PUBLISHED' && assessment.type === 'EXAMINATION'
    && assessment.resultsReleased && resultsReleased !== false) {
    return fail(res, 'Hide examination results before reopening the examination', 409);
  }
  if (status === 'PUBLISHED') {
    const assessmentData = await prisma.assessment.findUnique({
      where: { id: req.params.id },
      include: { questions: true },
    });
    const readinessError = validateAssessmentSettings({
      title: title ?? assessmentData.title,
      timeLimitMin: timeLimitMin ?? assessmentData.timeLimitMin,
      attemptLimit: attemptLimit ?? assessmentData.attemptLimit,
      passMarkPercent: passMarkPercent ?? assessmentData.passMarkPercent,
      type: type ?? assessmentData.type,
      status,
      availableFrom: effectiveAvailableFrom?.toISOString() || null,
      availableTo: effectiveAvailableTo?.toISOString() || null,
    });
    if (readinessError) return fail(res, readinessError, 400);
    if (!assessmentData.questions.length || assessmentData.questions.some((question) => validateQuestion(question))) {
      return fail(res, 'Add valid questions before publishing the assessment', 422);
    }
  }
  const data = {};
  if (title !== undefined) data.title = title.trim();
  if (description !== undefined) data.description = description;
  if (instructions !== undefined) data.instructions = instructions || null;
  if (timeLimitMin !== undefined) data.timeLimitMin = timeLimitMin ? Number(timeLimitMin) : null;
  if (attemptLimit !== undefined) data.attemptLimit = Number(attemptLimit);
  if (passMarkPercent !== undefined) data.passMarkPercent = Number(passMarkPercent);
  if (type !== undefined) data.type = type;
  if (resultsReleased !== undefined) data.resultsReleased = resultsReleased;
  if (status) data.status = status;
  if (availableFrom !== undefined) data.availableFrom = availableFrom ? new Date(availableFrom) : null;
  if (availableTo !== undefined) data.availableTo = availableTo ? new Date(availableTo) : null;
  if (offeringValidation) data.programOfferingId = offeringValidation.programOfferingId;
  const a = resultsReleased === false
    ? await prisma.$transaction(async (transaction) => {
      const updated = await transaction.assessment.update({ where: { id: req.params.id }, data });
      await transaction.assessmentAttempt.updateMany({
        where: { assessmentId: req.params.id },
        data: { resultsReleasedAt: null },
      });
      return updated;
    })
    : await prisma.assessment.update({ where: { id: req.params.id }, data });
  if (resultsReleased !== undefined && resultsReleased !== assessment.resultsReleased) {
    await audit({
      actorId: req.user.id,
      action: resultsReleased ? 'RELEASE_EXAMINATION_RESULTS' : 'WITHDRAW_EXAMINATION_RESULTS',
      entity: 'Assessment',
      entityId: a.id,
      ipAddress: req.ip,
    });
  }
  return ok(res, a, 'Updated');
};

export const releaseAttemptResults = async (req, res) => {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: req.params.attemptId },
    include: { assessment: { select: { id: true, type: true } } },
  });
  if (!attempt) return fail(res, 'Attempt not found', 404);
  if (attempt.assessment.type !== 'EXAMINATION') {
    return fail(res, 'Only examination results require manual release', 400);
  }
  if (!attempt.submittedAt || attempt.status !== 'GRADED') {
    return fail(res, 'Submit and grade this examination before releasing its result', 409);
  }
  if (attempt.resultsReleasedAt) return ok(res, attempt, 'Examination result already released');

  const updated = await prisma.assessmentAttempt.update({
    where: { id: attempt.id },
    data: { resultsReleasedAt: new Date() },
  });
  await audit({
    actorId: req.user.id,
    action: 'RELEASE_EXAMINATION_ATTEMPT_RESULT',
    entity: 'AssessmentAttempt',
    entityId: attempt.id,
    ipAddress: req.ip,
  });
  return ok(res, updated, 'Examination result released');
};

export const deleteAssessment = async (req, res) => {
  const assessment = await canManageAssessment(req.params.id, req.user);
  if (assessment === null) return fail(res, 'Not found', 404);
  if (!assessment) return fail(res, 'You are not assigned to this course', 403);
  const attemptCount = await prisma.assessmentAttempt.count({ where: { assessmentId: req.params.id } });
  if (attemptCount) return fail(res, 'This assessment has learner attempts and cannot be deleted', 409);
  await prisma.assessment.delete({ where: { id: req.params.id } });
  return ok(res, null, 'Deleted');
};

export const addQuestion = async (req, res) => {
  const assessment = await canManageAssessment(req.params.id, req.user);
  if (assessment === null) return fail(res, 'Not found', 404);
  if (!assessment) return fail(res, 'You are not assigned to this course', 403);
  if (assessment.status === 'PUBLISHED') return fail(res, 'Unpublish the assessment before adding questions', 409);
  const { type, prompt, points, options, correctAnswer, explanation } = req.body || {};
  const validationError = validateQuestion({ type, prompt, points, options, correctAnswer });
  if (validationError) return fail(res, validationError, 400);
  const count = await prisma.question.count({ where: { assessmentId: req.params.id } });
  const q = await prisma.question.create({
    data: {
      assessmentId: req.params.id,
      type,
      prompt: prompt.trim(),
      points: points ? Number(points) : 1,
      position: count,
      options: options ?? Prisma.DbNull,
      correctAnswer: correctAnswer ?? Prisma.DbNull,
      explanation: explanation || null,
    },
  });
  return ok(res, q, 'Created', 201);
};

export const updateQuestion = async (req, res) => {
  const question = await prisma.question.findUnique({
    where: { id: req.params.id },
    select: { assessmentId: true, type: true, prompt: true, points: true, options: true, correctAnswer: true },
  });
  if (!question) return fail(res, 'Not found', 404);
  const assessment = await canManageAssessment(question.assessmentId, req.user);
  if (!assessment) return fail(res, 'You are not assigned to this course', 403);
  const { type, prompt, points, options, correctAnswer, explanation, position } = req.body || {};
  if (position !== undefined && (!Number.isInteger(Number(position)) || Number(position) < 0)) {
    return fail(res, 'Question position must be a non-negative integer', 400);
  }
  const attemptCount = await prisma.assessmentAttempt.count({ where: { assessmentId: question.assessmentId } });
  if (attemptCount) return fail(res, 'Questions cannot be changed after learners have started attempts', 409);
  if (assessment.status === 'PUBLISHED') return fail(res, 'Unpublish the assessment before changing its questions', 409);
  const validationError = validateQuestion({
    type: type ?? question.type,
    prompt: prompt ?? question.prompt,
    points: points ?? question.points,
    options: options ?? question.options,
    correctAnswer: correctAnswer ?? question.correctAnswer,
  });
  if (validationError) return fail(res, validationError, 400);
  const data = {};
  if (type) data.type = type;
  if (prompt !== undefined) data.prompt = prompt.trim();
  if (points !== undefined) data.points = Number(points);
  if (options !== undefined) data.options = options ?? Prisma.DbNull;
  if (correctAnswer !== undefined) data.correctAnswer = correctAnswer ?? Prisma.DbNull;
  if (explanation !== undefined) data.explanation = explanation || null;
  if (position !== undefined) data.position = Number(position);
  const q = await prisma.question.update({ where: { id: req.params.id }, data });
  return ok(res, q, 'Updated');
};

export const deleteQuestion = async (req, res) => {
  const question = await prisma.question.findUnique({
    where: { id: req.params.id },
    select: { assessmentId: true },
  });
  if (!question) return fail(res, 'Not found', 404);
  const assessment = await canManageAssessment(question.assessmentId, req.user);
  if (!assessment) return fail(res, 'You are not assigned to this course', 403);
  const attemptCount = await prisma.assessmentAttempt.count({ where: { assessmentId: question.assessmentId } });
  if (attemptCount) return fail(res, 'This question has learner attempts and cannot be deleted', 409);
  if (assessment.status === 'PUBLISHED') return fail(res, 'Unpublish the assessment before deleting its questions', 409);
  await prisma.question.delete({ where: { id: req.params.id } });
  return ok(res, null, 'Deleted');
};

export const startAttempt = async (req, res) => {
  const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!assessment || assessment.status !== 'PUBLISHED') return fail(res, 'Assessment not available', 404);
  if (!isAssessmentOpen(assessment)) return fail(res, 'Assessment is not currently available', 403);
  if (!(await canAccessCourse(assessment.courseId, req.user))) return fail(res, 'Not enrolled in this course', 403);
  if (!(await assessmentOfferingMatchesStudent(assessment, req.user.id))) return fail(res, 'Assessment not available', 404);
  const questionCount = await prisma.question.count({ where: { assessmentId: assessment.id } });
  if (!questionCount) return fail(res, 'Assessment has no questions yet', 409);
  let result;
  try {
    result = await prisma.$transaction(async (transaction) => {
      const where = { assessmentId: assessment.id, studentId: req.user.id };
      const existing = await transaction.assessmentAttempt.count({ where });
      if (existing >= assessment.attemptLimit) return { limitReached: true };
      const attempt = await transaction.assessmentAttempt.create({
        data: { assessmentId: assessment.id, studentId: req.user.id, maxScore: 0 },
      });
      return { attempt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error.code === 'P2034') {
      return fail(res, 'Another assessment attempt was started at the same time. Reload and try again.', 409);
    }
    throw error;
  }
  if (result.limitReached) return fail(res, 'Attempt limit reached', 403);
  return ok(res, result.attempt, 'Started', 201);
};

export const saveAnswer = async (req, res) => {
  const { attemptId, questionId, answer } = req.body || {};
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: attemptId },
    include: { assessment: true },
  });
  if (!attempt || attempt.studentId !== req.user.id) return fail(res, 'Not found', 404);
  if (attempt.submittedAt) return fail(res, 'Already submitted', 409);
  if (!isAttemptWithinTimeLimit(attempt)) {
    await finalizeAttempt(attempt, new Date());
    return fail(res, 'Assessment time limit elapsed; saved answers were submitted', 409);
  }
  if (!isAssessmentOpen(attempt.assessment)) return fail(res, 'Assessment is not currently available', 403);
  if (!(await canAccessCourse(attempt.assessment.courseId, req.user))) return fail(res, 'Not enrolled in this course', 403);
  if (!(await assessmentOfferingMatchesStudent(attempt.assessment, req.user.id))) return fail(res, 'Not found', 404);
  if (answer === undefined || answer === null) return fail(res, 'answer is required', 400);
  const question = await prisma.question.findUnique({ where: { id: questionId }, select: { assessmentId: true } });
  if (!question || question.assessmentId !== attempt.assessmentId) return fail(res, 'Question does not belong to this attempt', 400);
  const now = new Date();
  const limitMinutes = attempt.assessment.timeLimitMin;
  const saved = await prisma.$transaction(async (transaction) => {
    const active = await transaction.assessmentAttempt.updateMany({
      where: {
        id: attemptId,
        submittedAt: null,
        ...(limitMinutes ? { startedAt: { gte: new Date(now.getTime() - limitMinutes * 60_000) } } : {}),
      },
      data: { status: 'IN_PROGRESS' },
    });
    if (!active.count) return null;
    return transaction.assessmentAnswer.upsert({
      where: { attemptId_questionId: { attemptId, questionId } },
      create: { attemptId, questionId, answer },
      update: { answer },
    });
  });
  if (!saved) {
    if (!attempt.submittedAt && !isAttemptWithinTimeLimit(attempt, now)) {
      await finalizeAttempt(attempt, now);
      return fail(res, 'Assessment time limit elapsed; saved answers were submitted', 409);
    }
    return fail(res, 'Already submitted', 409);
  }
  return ok(res, saved, 'Saved');
};

export const submitAttempt = async (req, res) => {
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: req.params.attemptId },
    include: { assessment: { include: { questions: true } }, answers: true },
  });
  if (!attempt || attempt.studentId !== req.user.id) return fail(res, 'Not found', 404);
  if (attempt.submittedAt) return fail(res, 'Already submitted', 409);
  if (!(await canAccessCourse(attempt.assessment.courseId, req.user))) return fail(res, 'Not enrolled in this course', 403);
  if (!(await assessmentOfferingMatchesStudent(attempt.assessment, req.user.id))) return fail(res, 'Not found', 404);

  const updated = await finalizeAttempt(attempt);
  if (!updated) return fail(res, 'Already submitted', 409);
  return ok(res, getAttemptView(updated, 'STUDENT'), 'Submitted');
};

export const gradeAttempt = async (req, res) => {
  const { answers } = req.body || {};
  if (!Array.isArray(answers) || !answers.length) return fail(res, 'Provide at least one answer score', 400);
  if (answers.some(({ feedback }) => feedback !== undefined && (typeof feedback !== 'string' || feedback.length > 2000))) {
    return fail(res, 'Feedback must be text no longer than 2000 characters', 400);
  }
  const attempt = await prisma.assessmentAttempt.findUnique({
    where: { id: req.params.attemptId },
    include: { assessment: { include: { questions: true } }, answers: true },
  });
  if (!attempt) return fail(res, 'Attempt not found', 404);
  if (!attempt.submittedAt) return fail(res, 'Attempt has not been submitted', 409);
  if (req.user.role.name === 'TRAINER' && !(await canManageCourse(attempt.assessment.courseId, req.user))) {
    return fail(res, 'You are not assigned to this course', 403);
  }

  const questionById = new Map(attempt.assessment.questions.map((question) => [question.id, question]));
  const answerByQuestionId = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
  const gradedAnswers = [];
  const gradedQuestionIds = new Set();
  for (const item of answers) {
    if (gradedQuestionIds.has(item.questionId)) return fail(res, 'Do not grade the same answer more than once', 400);
    gradedQuestionIds.add(item.questionId);
    const question = questionById.get(item.questionId);
    const answer = answerByQuestionId.get(item.questionId);
    const points = Number(item.points);
    if (!question || !answer || !Number.isFinite(points) || points < 0 || points > question.points) {
      return fail(res, 'One or more answer scores are invalid', 400);
    }
    gradedAnswers.push({
      questionId: question.id,
      points,
      feedback: item.feedback === undefined ? answer.feedback : item.feedback.trim(),
    });
  }

  const result = scoreAssessmentAttempt(attempt, gradedAnswers);
  await prisma.$transaction(async (transaction) => {
    for (const answer of result.answerUpdates) {
      await transaction.assessmentAnswer.update({
        where: { id: answer.answerId },
        data: { points: answer.points, feedback: answer.feedback, isCorrect: answer.isCorrect },
      });
    }
    await transaction.assessmentAttempt.update({
      where: { id: attempt.id },
      data: { score: result.score, maxScore: result.maxScore, status: result.status },
    });
  });
  const updated = {
    ...attempt,
    score: result.score,
    maxScore: result.maxScore,
    status: result.status,
    answers: attempt.answers.map((answer) => {
      const update = result.answerUpdates.find((item) => item.answerId === answer.id);
      return update ? { ...answer, ...update } : answer;
    }),
  };
  await audit({ actorId: req.user.id, action: 'GRADE_ASSESSMENT', entity: 'AssessmentAttempt', entityId: attempt.id, ipAddress: req.ip });
  return ok(res, updated, 'Assessment graded');
};

export const getAttempt = async (req, res) => {
  let a = await prisma.assessmentAttempt.findUnique({
    where: { id: req.params.id },
    include: {
      answers: true,
      assessment: {
        include: {
          questions: { orderBy: { position: 'asc' } },
          programOffering: {
            select: {
              id: true,
              intake: { select: { gateNumber: true, season: true, year: true } },
              programme: { select: { title: true } },
            },
          },
        },
      },
    },
  });
  if (!a) return fail(res, 'Not found', 404);
  if (a.studentId !== req.user.id && !['SUPER_ADMIN', 'TRAINER'].includes(req.user.role.name)) {
    return fail(res, 'Forbidden', 403);
  }
  if (req.user.role.name === 'TRAINER' && !(await canManageCourse(a.assessment.courseId, req.user))) {
    return fail(res, 'You are not assigned to this course', 403);
  }
  if (req.user.role.name === 'STUDENT' && !(await canAccessCourse(a.assessment.courseId, req.user))) {
    return fail(res, 'Not found', 404);
  }
  if (req.user.role.name === 'STUDENT'
    && !(await assessmentOfferingMatchesStudent(a.assessment, req.user.id))) {
    return fail(res, 'Not found', 404);
  }
  if (req.user.role.name === 'STUDENT' && !a.submittedAt && !isAttemptWithinTimeLimit(a)) {
    a = await finalizeAttempt(a) || a;
  }
  return ok(res, getAttemptView(a, req.user.role.name));
};

export const listAttempts = async (req, res) => {
  const where = {};
  if (req.query.assessmentId) where.assessmentId = req.query.assessmentId;
  if (req.query.studentId) where.studentId = req.query.studentId;
  if (req.user.role.name === 'STUDENT') where.studentId = req.user.id;
  if (req.user.role.name === 'STUDENT') {
    where.assessment = {
      AND: [
        { course: studentCourseAccessWhere(req.user.id) },
        assessmentOfferingForStudentWhere(req.user.id),
      ],
    };
  }
  if (req.user.role.name === 'TRAINER') {
    where.assessment = { course: { trainers: { some: { trainerId: req.user.id } } } };
  }
  if (req.user.role.name === 'STUDENT') {
    const inProgressAttempts = await prisma.assessmentAttempt.findMany({
      where: {
        studentId: req.user.id,
        submittedAt: null,
        assessment: {
          AND: [
            { course: studentCourseAccessWhere(req.user.id) },
            { timeLimitMin: { not: null } },
            assessmentOfferingForStudentWhere(req.user.id),
          ],
        },
      },
      include: { assessment: { include: { questions: true } }, answers: true },
    });
    for (const attempt of inProgressAttempts) {
      if (!isAttemptWithinTimeLimit(attempt)) await finalizeAttempt(attempt);
    }
  }
  const items = await prisma.assessmentAttempt.findMany({
    where,
    include: {
      student: { select: { id: true, firstName: true, lastName: true, email: true } },
      assessment: {
        include: {
          programOffering: {
            select: {
              id: true,
              intake: { select: { gateNumber: true, season: true, year: true } },
              programme: { select: { title: true } },
            },
          },
        },
      },
    },
    orderBy: { startedAt: 'desc' },
  });
  return ok(res, items.map((attempt) => {
    const examinationResultsPending = req.user.role.name === 'STUDENT'
      && attempt.assessment?.type === 'EXAMINATION'
      && !attempt.assessment.resultsReleased
      && !attempt.resultsReleasedAt;
    const score = examinationResultsPending ? null : attempt.score;
    const maxScore = examinationResultsPending ? null : attempt.maxScore;
    return {
      ...attempt,
      score,
      maxScore,
      passed: score !== null && score !== undefined && maxScore > 0
        ? (score / maxScore) * 100 >= (attempt.assessment?.passMarkPercent ?? 50)
        : null,
    };
  }));
};
