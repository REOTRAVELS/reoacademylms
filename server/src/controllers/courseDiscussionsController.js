import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { parseListOptions, parseOptionalId } from '../utils/notificationPolicies.js';
import {
  resolveCourseDiscussionScope,
  resolveDiscussionPostScope,
} from '../utils/courseDiscussionAccess.js';

const reportReasons = new Set(['SPAM', 'HARASSMENT', 'PERSONAL_INFORMATION', 'OTHER']);
const reviewStatuses = new Set(['ACTIONED', 'DISMISSED']);
const moderationActions = new Set([
  'PIN', 'UNPIN', 'LOCK', 'UNLOCK', 'RESOLVE', 'REOPEN', 'REMOVE', 'RESTORE',
]);
const authorFields = {
  id: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  role: { select: { name: true } },
};

const failAccess = (res, error) => (
  error === 'FORBIDDEN'
    ? fail(res, 'You are not assigned to this course and Program Offering.', 403)
    : fail(res, 'Not found', 404)
);

const cleanText = (value, minLength, maxLength) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (
    text.length < minLength
    || text.length > maxLength
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
  ) return null;
  return text;
};

const onlyKeys = (body, allowed) => (
  Object.keys(body || {}).every((key) => allowed.includes(key))
);

const parseSearch = (value) => {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.trim() !== value || value.length > 100
    || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
};

const cursorExistsInScope = async (model, where, pagination) => {
  if (!pagination.cursor) return true;
  const cursor = await model.findFirst({
    where: { ...where, id: pagination.cursor.id },
    select: { id: true },
  });
  return Boolean(cursor);
};

const listPage = (items, take) => ({
  items,
  nextCursor: take > 0 && items.length === take ? items.at(-1).id : null,
});

const selectedOffering = (value, scope) => {
  if (value === undefined) return null;
  const id = parseOptionalId(value);
  if (id === undefined) return undefined;
  if (id && !scope.offeringIds.includes(id)) return undefined;
  return id;
};

const publicPost = (post, revealRemoved = false) => {
  const { deletedById, moderationReason, _count, ...result } = post;
  if (post.deletedAt && !revealRemoved) {
    result.title = post.type === 'TOPIC' ? 'Removed discussion' : null;
    result.body = 'This post was removed by its author or a moderator.';
  }
  if (_count?.replies !== undefined) result.replyCount = _count.replies;
  return result;
};

const postInclude = {
  author: { select: authorFields },
  lesson: { select: { id: true, title: true } },
};

const addAnnouncementNotifications = async (transaction, post, course) => {
  const recipients = await transaction.programEnrollment.findMany({
    where: {
      programmeId: post.programmeId,
      programOfferingId: post.programOfferingId,
      status: 'ACTIVE',
      student: {
        status: 'ACTIVE',
        role: { name: 'STUDENT' },
        enrolments: {
          some: {
            cohort: {
              programmeId: post.programmeId,
              intakeProgramOfferingId: post.programOfferingId,
              courses: { some: { courseId: course.id } },
            },
          },
        },
      },
    },
    select: { studentId: true },
    distinct: ['studentId'],
  });
  const recipientIds = [...new Set(recipients
    .map(({ studentId }) => studentId)
    .filter((studentId) => studentId !== post.authorId))];
  if (!recipientIds.length) return;

  const label = `${post.title}`;
  await transaction.notification.createMany({
    data: recipientIds.map((userId) => ({
      userId,
      programmeId: post.programmeId,
      programOfferingId: post.programOfferingId,
      isGlobal: false,
      audienceStatus: 'CLASSIFIED',
      type: 'INFO',
      title: 'New Tutor announcement',
      body: `A new course announcement was posted: ${label}`,
      sourceKey: `discussion-announcement:${post.id}:${userId}`,
    })),
    skipDuplicates: true,
  });
};

const resolveOffering = (scope, value) => {
  if (typeof value !== 'string' || !scope.offeringIds.includes(value)) return null;
  return scope.offerings.find((offering) => offering.id === value) || null;
};

export const listCourseDiscussions = async (req, res) => {
  const scope = await resolveCourseDiscussionScope(req.params.courseId, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (!scope.offeringIds.length) {
    return ok(res, {
      ...listPage([], 0),
      offerings: [],
      permissions: { canModerate: scope.canModerate, canCreateAnnouncement: scope.canModerate },
    });
  }

  const pagination = parseListOptions(req.query);
  const search = parseSearch(req.query.search);
  const offeringId = selectedOffering(req.query.programOfferingId, scope);
  if (!pagination || search === null || offeringId === undefined) {
    return fail(res, 'Invalid search, Program Offering, or pagination options.', 400);
  }
  const where = {
    courseId: scope.course.id,
    programmeId: scope.course.programmeId,
    programOfferingId: offeringId ? { in: [offeringId] } : { in: scope.offeringIds },
    parentId: null,
    type: 'TOPIC',
    deletedAt: null,
    ...(search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };
  if (!await cursorExistsInScope(prisma.courseDiscussionPost, where, pagination)) {
    return fail(res, 'Invalid discussion cursor.', 400);
  }
  const items = await prisma.courseDiscussionPost.findMany({
    where,
    include: {
      ...postInclude,
      _count: { select: { replies: { where: { deletedAt: null } } } },
    },
    orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    ...pagination,
  });
  return ok(res, {
    ...listPage(items.map((post) => publicPost(post)), pagination.take),
    offerings: scope.offerings,
    permissions: { canModerate: scope.canModerate, canCreateAnnouncement: scope.canModerate },
  });
};

export const createCourseDiscussion = async (req, res) => {
  const scope = await resolveCourseDiscussionScope(req.params.courseId, req.user);
  if (scope.error) return failAccess(res, scope.error);
  const {
    title: rawTitle,
    body: rawBody,
    programOfferingId,
    lessonId: rawLessonId,
    isAnnouncement = false,
  } = req.body || {};
  if (!onlyKeys(req.body, ['title', 'body', 'programOfferingId', 'lessonId', 'isAnnouncement'])) {
    return fail(res, 'Only discussion fields may be submitted.', 400);
  }
  const title = cleanText(rawTitle, 5, 160);
  const body = cleanText(rawBody, 1, 10000);
  const offering = resolveOffering(scope, programOfferingId);
  const lessonId = parseOptionalId(rawLessonId);
  if (!title) return fail(res, 'Discussion title must be between 5 and 160 characters.', 400);
  if (!body) return fail(res, 'Discussion message must be between 1 and 10,000 characters.', 400);
  if (!offering) return fail(res, 'Choose a Program Offering associated with this course and your assignment or enrollment.', 403);
  if (lessonId === undefined) return fail(res, 'Invalid lesson.', 400);
  if (typeof isAnnouncement !== 'boolean') return fail(res, 'Announcement setting must be true or false.', 400);
  if (isAnnouncement && !scope.canModerate) return fail(res, 'Only assigned Tutors or administrators can post announcements.', 403);
  if (lessonId) {
    const lesson = await prisma.lesson.findFirst({
      where: {
        id: lessonId,
        module: { courseId: scope.course.id },
        ...(req.user.role.name === 'STUDENT' ? { isPublished: true } : {}),
      },
      select: { id: true },
    });
    if (!lesson) return fail(res, 'The selected lesson is not available in this course.', 400);
  }

  const result = await prisma.$transaction(async (transaction) => {
    const currentScope = await resolveCourseDiscussionScope(req.params.courseId, req.user, transaction);
    if (currentScope.error || !currentScope.offeringIds.includes(offering.id)) {
      return { error: currentScope.error || 'FORBIDDEN' };
    }
    const post = await transaction.courseDiscussionPost.create({
      data: {
        courseId: currentScope.course.id,
        programmeId: currentScope.course.programmeId,
        programOfferingId: offering.id,
        lessonId,
        type: 'TOPIC',
        title,
        body,
        isAnnouncement,
        authorId: req.user.id,
      },
      include: postInclude,
    });
    if (isAnnouncement) await addAnnouncementNotifications(transaction, post, currentScope.course);
    return { post };
  }, { isolationLevel: 'Serializable' });
  if (result.error) return failAccess(res, result.error);
  if (isAnnouncement) {
    await audit({
      actorId: req.user.id,
      action: 'CREATE_COURSE_ANNOUNCEMENT',
      entity: 'CourseDiscussionPost',
      entityId: result.post.id,
      metadata: {
        courseId: result.post.courseId,
        programmeId: result.post.programmeId,
        programOfferingId: result.post.programOfferingId,
      },
      ipAddress: req.ip,
    });
  }
  return ok(res, publicPost(result.post), 'Discussion created.', 201);
};

export const listDiscussionReplies = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (scope.post.type !== 'TOPIC' || (scope.post.deletedAt && !scope.canModerate)) return fail(res, 'Not found', 404);
  const pagination = parseListOptions(req.query, 20);
  if (!pagination) return fail(res, 'Invalid pagination options.', 400);
  const where = {
    parentId: scope.post.id,
    courseId: scope.post.courseId,
    programmeId: scope.post.programmeId,
    programOfferingId: scope.post.programOfferingId,
    type: 'REPLY',
  };
  if (!await cursorExistsInScope(prisma.courseDiscussionPost, where, pagination)) {
    return fail(res, 'Invalid reply cursor.', 400);
  }
  const items = await prisma.courseDiscussionPost.findMany({
    where,
    include: postInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...pagination,
  });
  return ok(res, listPage(items.map((post) => publicPost(post)), pagination.take));
};

export const getDiscussionPost = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (scope.post.deletedAt && !scope.canModerate) return fail(res, 'Not found', 404);
  const post = await prisma.courseDiscussionPost.findUnique({
    where: { id: scope.post.id },
    include: postInclude,
  });
  if (!post) return fail(res, 'Not found', 404);
  return ok(res, publicPost(post, scope.canModerate));
};

export const createDiscussionReply = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (scope.post.type !== 'TOPIC' || scope.post.deletedAt) return fail(res, 'Discussion not found.', 404);
  const body = cleanText(req.body?.body, 1, 10000);
  if (!onlyKeys(req.body, ['body']) || !body) {
    return fail(res, 'Reply must contain a message of 1 to 10,000 characters.', 400);
  }
  const result = await prisma.$transaction(async (transaction) => {
    const current = await resolveDiscussionPostScope(req.params.id, req.user, transaction);
    if (current.error || current.post.type !== 'TOPIC' || current.post.deletedAt) {
      return { error: current.error || 'NOT_FOUND' };
    }
    if (current.post.isLocked) return { error: 'LOCKED' };
    const reply = await transaction.courseDiscussionPost.create({
      data: {
        courseId: current.post.courseId,
        programmeId: current.post.programmeId,
        programOfferingId: current.post.programOfferingId,
        parentId: current.post.id,
        type: 'REPLY',
        body,
        authorId: req.user.id,
      },
      include: postInclude,
    });
    if (current.post.authorId !== req.user.id) {
      await transaction.notification.createMany({
        data: [{
          userId: current.post.authorId,
          programmeId: current.post.programmeId,
          programOfferingId: current.post.programOfferingId,
          isGlobal: false,
          audienceStatus: 'CLASSIFIED',
          type: 'INFO',
          title: 'New discussion reply',
          body: `Someone replied to your topic: ${current.post.title}`,
          sourceKey: `discussion-reply:${reply.id}:${current.post.authorId}`,
        }],
        skipDuplicates: true,
      });
    }
    return { reply };
  }, { isolationLevel: 'Serializable' });
  if (result.error === 'LOCKED') return fail(res, 'This discussion is locked and no longer accepts replies.', 409);
  if (result.error) return failAccess(res, result.error);
  return ok(res, publicPost(result.reply), 'Reply added.', 201);
};

export const updateDiscussionPost = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (scope.post.deletedAt) return fail(res, 'This post has been removed.', 409);
  if (scope.post.authorId !== req.user.id) return fail(res, 'You can only edit your own posts.', 403);
  if (!onlyKeys(req.body, ['title', 'body'])) return fail(res, 'Only the title and message may be edited.', 400);
  const data = {};
  if (Object.hasOwn(req.body || {}, 'title')) {
    if (scope.post.type !== 'TOPIC') return fail(res, 'Replies do not have a title.', 400);
    data.title = cleanText(req.body.title, 5, 160);
    if (!data.title) return fail(res, 'Discussion title must be between 5 and 160 characters.', 400);
  }
  if (Object.hasOwn(req.body || {}, 'body')) {
    data.body = cleanText(req.body.body, 1, 10000);
    if (!data.body) return fail(res, 'Message must be between 1 and 10,000 characters.', 400);
  }
  if (!Object.keys(data).length) return fail(res, 'Provide a title or message to update.', 400);
  const result = await prisma.$transaction(async (transaction) => {
    const current = await resolveDiscussionPostScope(req.params.id, req.user, transaction);
    if (current.error) return { error: current.error };
    if (current.post.deletedAt) return { error: 'REMOVED' };
    if (current.post.authorId !== req.user.id) return { error: 'FORBIDDEN' };
    const updated = await transaction.courseDiscussionPost.update({
      where: { id: current.post.id },
      data: { ...data, editedAt: new Date() },
      include: postInclude,
    });
    return { updated };
  }, { isolationLevel: 'Serializable' });
  if (result.error === 'REMOVED') return fail(res, 'This post has been removed.', 409);
  if (result.error) return failAccess(res, result.error);
  return ok(res, publicPost(result.updated), 'Post updated.');
};

const moderationState = (post) => ({
  isPinned: post.isPinned,
  isLocked: post.isLocked,
  isResolved: post.isResolved,
  deletedAt: post.deletedAt,
});

export const deleteDiscussionPost = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  const isAuthor = scope.post.authorId === req.user.id;
  if (!isAuthor && !scope.canModerate) return fail(res, 'You can only remove your own posts.', 403);
  if (scope.post.deletedAt) return fail(res, 'This post has already been removed.', 409);
  const reason = scope.canModerate && !isAuthor
    ? cleanText(req.body?.reason, 5, 500)
    : null;
  if (scope.canModerate && !isAuthor && !reason) {
    return fail(res, 'Provide a moderation reason between 5 and 500 characters.', 400);
  }
  const result = await prisma.$transaction(async (transaction) => {
    const current = await resolveDiscussionPostScope(req.params.id, req.user, transaction);
    if (current.error || current.post.deletedAt) return { error: current.error || 'NOT_FOUND' };
    const currentIsAuthor = current.post.authorId === req.user.id;
    if (!currentIsAuthor && !current.canModerate) return { error: 'FORBIDDEN' };
    if (current.canModerate && !currentIsAuthor && !reason) return { error: 'INVALID_REASON' };
    const beforeState = moderationState(current.post);
    const updated = await transaction.courseDiscussionPost.update({
      where: { id: current.post.id },
      data: { deletedAt: new Date(), deletedById: req.user.id, moderationReason: reason },
    });
    await transaction.courseDiscussionModeration.create({
      data: {
        postId: current.post.id,
        actorId: req.user.id,
        action: currentIsAuthor ? 'AUTHOR_DELETE' : 'REMOVE',
        reason,
        beforeState,
        afterState: moderationState(updated),
      },
    });
    return { updated, current, currentIsAuthor };
  }, { isolationLevel: 'Serializable' });
  if (result.error === 'INVALID_REASON') return fail(res, 'Provide a moderation reason between 5 and 500 characters.', 400);
  if (result.error) return failAccess(res, result.error);
  if (result.current.canModerate && !result.currentIsAuthor) {
    await audit({
      actorId: req.user.id,
      action: 'MODERATE_COURSE_DISCUSSION',
      entity: 'CourseDiscussionPost',
      entityId: scope.post.id,
      metadata: {
        action: 'REMOVE',
        courseId: scope.post.courseId,
        programOfferingId: scope.post.programOfferingId,
        reason,
      },
      ipAddress: req.ip,
    });
  }
  return ok(res, publicPost(result.updated), 'Post removed.');
};

export const moderateDiscussionPost = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (!scope.canModerate) return fail(res, 'Tutor or administrator permission is required.', 403);
  const { action } = req.body || {};
  if (!moderationActions.has(action) || !onlyKeys(req.body, ['action', 'reason'])) {
    return fail(res, 'Choose a supported moderation action.', 400);
  }
  if (action !== 'REMOVE' && action !== 'RESTORE' && scope.post.type !== 'TOPIC') {
    return fail(res, 'This moderation action applies only to discussion topics.', 400);
  }
  const reason = req.body.reason === undefined ? null : cleanText(req.body.reason, 5, 500);
  if (req.body.reason !== undefined && !reason) return fail(res, 'Moderation reason must be between 5 and 500 characters.', 400);
  if (['REMOVE', 'RESTORE'].includes(action) && !reason) {
    return fail(res, 'Provide a moderation reason between 5 and 500 characters.', 400);
  }
  const dataByAction = {
    PIN: { isPinned: true },
    UNPIN: { isPinned: false },
    LOCK: { isLocked: true },
    UNLOCK: { isLocked: false },
    RESOLVE: { isResolved: true },
    REOPEN: { isResolved: false },
    REMOVE: { deletedAt: new Date(), deletedById: req.user.id, moderationReason: reason },
    RESTORE: { deletedAt: null, deletedById: null, moderationReason: null },
  };
  if (action === 'REMOVE' && scope.post.deletedAt) return fail(res, 'This post has already been removed.', 409);
  if (action === 'RESTORE' && !scope.post.deletedAt) return fail(res, 'This post is not removed.', 409);
  if (scope.post.deletedAt && action !== 'RESTORE') {
    return fail(res, 'Removed posts can only be restored.', 409);
  }
  const result = await prisma.$transaction(async (transaction) => {
    const current = await resolveDiscussionPostScope(req.params.id, req.user, transaction);
    if (current.error) return { error: current.error };
    if (!current.canModerate) return { error: 'FORBIDDEN' };
    if (action !== 'REMOVE' && action !== 'RESTORE' && current.post.type !== 'TOPIC') {
      return { error: 'INVALID_TYPE' };
    }
    if (action === 'REMOVE' && current.post.deletedAt) return { error: 'ALREADY_REMOVED' };
    if (action === 'RESTORE' && !current.post.deletedAt) return { error: 'NOT_REMOVED' };
    if (current.post.deletedAt && action !== 'RESTORE') return { error: 'REMOVED' };
    const updated = await transaction.courseDiscussionPost.update({
      where: { id: current.post.id },
      data: dataByAction[action],
    });
    await transaction.courseDiscussionModeration.create({
      data: {
        postId: current.post.id,
        actorId: req.user.id,
        action,
        reason,
        beforeState: moderationState(current.post),
        afterState: moderationState(updated),
      },
    });
    return { updated };
  }, { isolationLevel: 'Serializable' });
  if (result.error === 'INVALID_TYPE') return fail(res, 'This moderation action applies only to discussion topics.', 400);
  if (result.error === 'ALREADY_REMOVED') return fail(res, 'This post has already been removed.', 409);
  if (result.error === 'REMOVED') return fail(res, 'Removed posts can only be restored.', 409);
  if (result.error === 'NOT_REMOVED') return fail(res, 'This post is not removed.', 409);
  if (result.error) return failAccess(res, result.error);
  await audit({
    actorId: req.user.id,
    action: 'MODERATE_COURSE_DISCUSSION',
    entity: 'CourseDiscussionPost',
    entityId: scope.post.id,
    metadata: {
      action,
      courseId: scope.post.courseId,
      programOfferingId: scope.post.programOfferingId,
      reason,
    },
    ipAddress: req.ip,
  });
  return ok(res, publicPost(result.updated), 'Discussion updated.');
};

export const reportDiscussionPost = async (req, res) => {
  const scope = await resolveDiscussionPostScope(req.params.id, req.user);
  if (scope.error) return failAccess(res, scope.error);
  if (scope.post.deletedAt) return fail(res, 'Removed posts cannot be reported.', 409);
  if (scope.post.authorId === req.user.id) return fail(res, 'You cannot report your own post.', 400);
  const { reason, details: rawDetails } = req.body || {};
  if (!onlyKeys(req.body, ['reason', 'details']) || !reportReasons.has(reason)) {
    return fail(res, 'Choose a valid reason for reporting this post.', 400);
  }
  const details = rawDetails === undefined || rawDetails === '' ? null : cleanText(rawDetails, 1, 1000);
  if (rawDetails !== undefined && rawDetails !== '' && !details) {
    return fail(res, 'Report details must be 1 to 1,000 characters.', 400);
  }
  try {
    const report = await prisma.courseDiscussionReport.create({
      data: { postId: scope.post.id, reporterId: req.user.id, reason, details },
      select: { id: true, postId: true, reason: true, details: true, status: true, createdAt: true },
    });
    return ok(res, report, 'Report submitted for review.', 201);
  } catch (error) {
    if (error?.code === 'P2002') return fail(res, 'You have already reported this post.', 409);
    throw error;
  }
};

const resolveModeratorFilter = async (req, res) => {
  if (!['SUPER_ADMIN', 'TRAINER'].includes(req.user.role.name)) {
    return { response: fail(res, 'Tutor or administrator permission is required.', 403) };
  }
  const courseId = parseOptionalId(req.query.courseId);
  const requestedOfferingId = parseOptionalId(req.query.programOfferingId);
  if (courseId === undefined || requestedOfferingId === undefined) {
    return { response: fail(res, 'Invalid course or Program Offering id.', 400) };
  }
  if (requestedOfferingId && !courseId) {
    return { response: fail(res, 'Choose a course when filtering by Program Offering.', 400) };
  }
  if (req.user.role.name === 'TRAINER' && !courseId) {
    return { response: fail(res, 'Choose one of your assigned courses.', 400) };
  }
  if (!courseId) return { where: {} };
  const scope = await resolveCourseDiscussionScope(courseId, req.user);
  if (scope.error) return { response: failAccess(res, scope.error) };
  const offeringId = selectedOffering(requestedOfferingId, scope);
  if (offeringId === undefined) return { response: fail(res, 'Invalid Program Offering.', 400) };
  return {
    scope,
    where: {
      post: {
        courseId: scope.course.id,
        programmeId: scope.course.programmeId,
        programOfferingId: offeringId ? { in: [offeringId] } : { in: scope.offeringIds },
      },
    },
  };
};

export const listDiscussionReports = async (req, res) => {
  const filter = await resolveModeratorFilter(req, res);
  if (filter.response) return filter.response;
  const pagination = parseListOptions(req.query, 25);
  const status = req.query.status === undefined ? 'OPEN' : req.query.status;
  if (!pagination || !['OPEN', 'ACTIONED', 'DISMISSED', 'ALL'].includes(status)) {
    return fail(res, 'Invalid report status or pagination options.', 400);
  }
  const where = {
    ...(status === 'ALL' ? {} : { status }),
    ...(filter.where && Object.keys(filter.where).length ? filter.where : {}),
  };
  if (!await cursorExistsInScope(prisma.courseDiscussionReport, where, pagination)) {
    return fail(res, 'Invalid report cursor.', 400);
  }
  const reports = await prisma.courseDiscussionReport.findMany({
    where,
    include: {
      reporter: { select: authorFields },
      reviewedBy: { select: authorFields },
      post: { include: postInclude },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...pagination,
  });
  return ok(res, {
    ...listPage(reports.map((report) => ({
      ...report,
      post: publicPost(report.post, true),
    })), pagination.take),
  });
};

export const reviewDiscussionReport = async (req, res) => {
  if (!['SUPER_ADMIN', 'TRAINER'].includes(req.user.role.name)) {
    return fail(res, 'Tutor or administrator permission is required.', 403);
  }
  const { status, reason: rawReason, removePost = false } = req.body || {};
  if (!reviewStatuses.has(status) || typeof removePost !== 'boolean'
    || !onlyKeys(req.body, ['status', 'reason', 'removePost'])) {
    return fail(res, 'Choose a valid report decision.', 400);
  }
  const reason = rawReason === undefined ? null : cleanText(rawReason, 5, 500);
  if (rawReason !== undefined && !reason) return fail(res, 'Resolution must be between 5 and 500 characters.', 400);
  if (removePost && !reason) return fail(res, 'Provide a reason before removing reported content.', 400);
  const report = await prisma.courseDiscussionReport.findUnique({
    where: { id: req.params.id },
    select: { id: true, postId: true, status: true },
  });
  if (!report) return fail(res, 'Report not found.', 404);
  const postScope = await resolveDiscussionPostScope(report.postId, req.user);
  if (postScope.error) return failAccess(res, postScope.error);
  if (!postScope.canModerate) return fail(res, 'Tutor or administrator permission is required.', 403);
  if (report.status !== 'OPEN') return fail(res, 'This report has already been reviewed.', 409);

  const result = await prisma.$transaction(async (transaction) => {
    const currentReport = await transaction.courseDiscussionReport.findUnique({
      where: { id: report.id },
      select: { id: true, postId: true, status: true },
    });
    if (!currentReport || currentReport.status !== 'OPEN') return { error: 'CONFLICT' };
    const currentPost = await resolveDiscussionPostScope(currentReport.postId, req.user, transaction);
    if (currentPost.error || !currentPost.canModerate) return { error: currentPost.error || 'FORBIDDEN' };
    const beforeState = moderationState(currentPost.post);
    const updatedReport = await transaction.courseDiscussionReport.update({
      where: { id: currentReport.id },
      data: {
        status,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
        resolution: reason,
      },
    });
    let updatedPost = currentPost.post;
    if (removePost && !currentPost.post.deletedAt) {
      updatedPost = await transaction.courseDiscussionPost.update({
        where: { id: currentPost.post.id },
        data: {
          deletedAt: new Date(),
          deletedById: req.user.id,
          moderationReason: reason,
        },
      });
      await transaction.courseDiscussionModeration.create({
        data: {
          postId: currentPost.post.id,
          reportId: currentReport.id,
          actorId: req.user.id,
          action: 'REMOVE',
          reason,
          beforeState,
          afterState: moderationState(updatedPost),
        },
      });
    }
    await transaction.courseDiscussionModeration.create({
      data: {
        postId: currentPost.post.id,
        reportId: currentReport.id,
        actorId: req.user.id,
        action: status === 'ACTIONED' ? 'REPORT_ACTIONED' : 'REPORT_DISMISSED',
        reason,
        beforeState: { reportStatus: currentReport.status },
        afterState: { reportStatus: updatedReport.status },
      },
    });
    return { report: updatedReport, post: updatedPost, scope: currentPost };
  }, { isolationLevel: 'Serializable' });
  if (result.error === 'CONFLICT') return fail(res, 'This report has already been reviewed.', 409);
  if (result.error) return failAccess(res, result.error);
  await audit({
    actorId: req.user.id,
    action: 'REVIEW_COURSE_DISCUSSION_REPORT',
    entity: 'CourseDiscussionReport',
    entityId: report.id,
    metadata: {
      status,
      courseId: postScope.post.courseId,
      programOfferingId: postScope.post.programOfferingId,
      removePost,
      reason,
    },
    ipAddress: req.ip,
  });
  return ok(res, {
    ...result.report,
    post: publicPost(result.post, true),
  }, 'Report reviewed.');
};

export const listDiscussionModerationHistory = async (req, res) => {
  const filter = await resolveModeratorFilter(req, res);
  if (filter.response) return filter.response;
  const pagination = parseListOptions(req.query, 25);
  if (!pagination) return fail(res, 'Invalid pagination options.', 400);
  const where = filter.where || {};
  if (!await cursorExistsInScope(prisma.courseDiscussionModeration, where, pagination)) {
    return fail(res, 'Invalid moderation history cursor.', 400);
  }
  const events = await prisma.courseDiscussionModeration.findMany({
    where,
    include: {
      actor: { select: authorFields },
      post: {
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          courseId: true,
          programmeId: true,
          programOfferingId: true,
          deletedAt: true,
          course: { select: { title: true } },
        },
      },
      report: { select: { id: true, reason: true, status: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...pagination,
  });
  return ok(res, listPage(events, pagination.take));
};
