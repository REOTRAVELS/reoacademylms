import prisma from '../config/database.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { env } from '../config/env.js';
import { audit } from '../utils/audit.js';
import { ok, fail } from '../utils/response.js';
import crypto from 'crypto';
import {
  isEmailDeliveryConfigured,
  sendPasswordResetEmail,
  sendInvitationEmail,
} from '../services/emailService.js';
import { AdmissionsError, createApplicationInTransaction } from '../services/admissions.js';
import { getStudentIntakeAccess } from '../utils/intakeAccess.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
});

const setSession = (res, user) => {
  const token = signToken({ sub: user.id, role: user.role.name });
  res.cookie(env.cookieName, token, cookieOptions());
};

const avatarUrlFor = (user) => (
  user.avatarUrl
    ? `/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarUrl)}`
    : null
);

const accessForUser = async (user) => {
  if (user.role.name !== 'STUDENT') {
    return { academicAccess: true, intakeAccessState: 'ELIGIBLE' };
  }
  const access = await getStudentIntakeAccess(user.id);
  const intake = access.state === 'WAITING'
    ? {
      id: access.enrollment.programOffering.intake.id,
      gateNumber: access.enrollment.programOffering.intake.gateNumber,
      season: access.enrollment.programOffering.intake.season,
      year: access.enrollment.programOffering.intake.year,
      academicStartDate: access.enrollment.programOffering.intake.academicStartDate,
      timezone: access.enrollment.programOffering.intake.timezone,
      programmeTitle: access.enrollment.programOffering.programme.title,
    }
    : null;
  return {
    academicAccess: access.state === 'ELIGIBLE',
    intakeAccessState: access.state,
    ...(intake ? { intake } : {}),
  };
};

export const register = async (req, res) => {
  const { firstName, lastName, email, phone, password, programOfferingId } = req.validated.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail(res, 'Email already registered', 409);
  const studentRole = await prisma.role.findUnique({ where: { name: 'STUDENT' } });
  if (!studentRole) return fail(res, 'Student role missing', 500);
  const passwordHash = await hashPassword(password);
  let user;
  let application;
  try {
    ({ user, application } = await prisma.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { firstName, lastName, email, phone, passwordHash, roleId: studentRole.id, status: 'PENDING' },
        include: { role: true },
      });
      const createdApplication = await createApplicationInTransaction(tx, {
        studentId: createdUser.id,
        programOfferingId,
      });
      return { user: createdUser, application: createdApplication };
    }));
  } catch (error) {
    if (error instanceof AdmissionsError) return fail(res, error.message, error.status);
    if (error.code === 'P2002') return fail(res, 'Email already registered or an application already exists', 409);
    throw error;
  }
  setSession(res, user);
  await audit({ actorId: user.id, action: 'REGISTER', entity: 'User', entityId: user.id, ipAddress: req.ip });
  return ok(res, {
    id: user.id,
    status: user.status,
    applicationId: application.id,
    academicAccess: false,
  }, 'Application submitted for review.', 201);
};

export const login = async (req, res) => {
  const { email, password } = req.validated.body;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) return fail(res, 'Invalid credentials', 401);
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return fail(res, 'Invalid credentials', 401);
  const applicantSession = user.role.name === 'STUDENT' && ['PENDING', 'REJECTED'].includes(user.status);
  if (user.status !== 'ACTIVE' && !applicantSession) {
    return fail(res, `Account is ${user.status.toLowerCase()}`, 403);
  }
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const access = await accessForUser(user);
  setSession(res, user);
  await audit({ actorId: user.id, action: 'LOGIN', entity: 'User', entityId: user.id, ipAddress: req.ip });
  return ok(res, {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role.name,
    status: user.status,
    ...access,
    avatarUrl: avatarUrlFor(user),
  }, access.intakeAccessState === 'WAITING'
    ? 'Program approved; academic access begins at the Intake start time.'
    : access.academicAccess ? 'Logged in' : 'Application access only');
};

export const logout = async (req, res) => {
  res.clearCookie(env.cookieName, { path: '/' });
  return ok(res, null, 'Logged out');
};

export const me = async (req, res) => {
  const u = req.user;
  const access = await accessForUser(u);
  return ok(res, {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role.name,
    status: u.status,
    ...access,
    avatarUrl: avatarUrlFor(u),
    bio: u.bio,
  });
};

export const acceptInvitation = async (req, res) => {
  const { token, password } = req.validated.body;
  const inv = await prisma.invitation.findUnique({ where: { token }, include: { acceptedBy: true } });
  if (!inv) return fail(res, 'Invalid invitation', 404);
  if (inv.acceptedAt) return fail(res, 'Invitation already used', 409);
  if (inv.expiresAt < new Date()) return fail(res, 'Invitation expired', 410);
  const role = await prisma.role.findUnique({ where: { id: inv.roleId } });
  if (!role) return fail(res, 'Role not found', 500);
  if (!['TRAINER', 'STUDENT'].includes(role.name)) {
    return fail(res, 'Only Trainer and Student invitations can be accepted.', 403);
  }
  const existingUser = await prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  if (existingUser) return fail(res, 'An account already exists for this email address.', 409);

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email: inv.email,
      passwordHash,
      firstName: 'Invited',
      lastName: role.name === 'STUDENT' ? 'Student' : 'User',
      roleId: role.id,
      status: 'ACTIVE',
    },
    include: { role: true },
  });
  await prisma.invitation.update({
    where: { id: inv.id },
    data: { acceptedAt: new Date(), acceptedById: user.id },
  });
  setSession(res, user);
  await audit({ actorId: user.id, action: 'ACCEPT_INVITATION', entity: 'Invitation', entityId: inv.id, ipAddress: req.ip });
  return ok(res, { id: user.id, role: user.role.name, status: user.status }, 'Invitation accepted', 201);
};

export const createInvitation = async (req, res) => {
  const { email, role: roleName } = req.validated.body;
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) return fail(res, 'An account already exists for this email address.', 409);

  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {},
    create: { name: roleName },
  });
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const inv = await prisma.invitation.create({
    data: { email, token, roleId: role.id, invitedById: req.user.id, expiresAt },
  });
  await audit({ actorId: req.user.id, action: 'CREATE_INVITATION', entity: 'Invitation', entityId: inv.id, ipAddress: req.ip });
  const invitationUrl = new URL(`/accept-invite/${token}`, env.clientUrl).toString();
  let emailSent = false;
  if (isEmailDeliveryConfigured()) {
    try {
      await sendInvitationEmail(email, invitationUrl, expiresAt, role.name);
      emailSent = true;
    } catch (error) {
      console.error('Account invitation email delivery failed:', error.code || error.name || 'Unknown error');
    }
  }
  return ok(
    res,
    { id: inv.id, token, invitationUrl, expiresAt, email, emailSent },
    emailSent ? `${role.name === 'STUDENT' ? 'Student' : 'Trainer'} invitation emailed` : 'Invitation created; share the secure link manually',
    201,
  );
};



export const forgotPassword = async (req, res) => {
  if (!isEmailDeliveryConfigured()) {
    return fail(res, 'Password reset is temporarily unavailable. Please try again later.', 503);
  }

  const { email } = req.validated.body;
  const user = await prisma.user.findUnique({ where: { email } });

  const token = crypto.randomBytes(32).toString('hex');
  const resetToken = crypto.createHash('sha256').update(token).digest('hex');
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
  }

  const resetUrl = new URL('/reset-password', env.clientUrl);
  resetUrl.searchParams.set('token', token);
  try {
    await sendPasswordResetEmail(email, resetUrl.toString());
  } catch (error) {
    if (user) {
      await prisma.user.updateMany({
        where: { id: user.id, resetToken },
        data: { resetToken: null, resetTokenExpiresAt: null },
      });
    }
    console.error('Password reset email delivery failed:', error.code || error.name || 'Unknown error');
    return fail(res, 'Password reset is temporarily unavailable. Please try again later.', 503);
  }
  return ok(res, null, 'If the address is associated with an account, password reset instructions have been sent.', 202);
};

export const resetPassword = async (req, res) => {
  const { token, password } = req.validated.body;
  const resetToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await prisma.user.findFirst({
    where: {
      resetToken,
      resetTokenExpiresAt: { gt: new Date() }, // Token not expired
    },
  });
  
  if (!user) return fail(res, 'Invalid or expired reset token', 400);

  // Hash the new password and update the user
  const passwordHash = await hashPassword(password);
  const updated = await prisma.user.updateMany({
    where: { id: user.id, resetToken, resetTokenExpiresAt: { gt: new Date() } },
    data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
  });
  if (updated.count !== 1) return fail(res, 'Invalid or expired reset token', 400);

  await audit({ actorId: user.id, action: 'RESET_PASSWORD', entity: 'User', entityId: user.id, ipAddress: req.ip });
  return ok(res, { id: user.id }, 'Password has been reset successfully', 200);
};

export const approveUser = async (req, res) => {
  const { userId, action } = req.validated.body;
  if (userId === req.user.id) return fail(res, 'You cannot change your own account status', 400);
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user) return fail(res, 'User not found', 404);
  if (user.role.name === 'SUPER_ADMIN') return fail(res, 'Administrator account status cannot be changed here', 403);
  if (user.role.name === 'STUDENT' && ['approve', 'reject'].includes(action)) {
    return fail(res, 'Student admission decisions must be made from the Program application review page', 409);
  }
  if (user.role.name === 'STUDENT' && action === 'reactivate' && user.status === 'REJECTED') {
    return fail(res, 'Rejected students must submit a new Program application before access can be restored', 409);
  }
  if (
    user.role.name === 'STUDENT'
    && ((action === 'suspend' && user.status !== 'ACTIVE')
      || (action === 'reactivate' && user.status !== 'SUSPENDED'))
  ) {
    return fail(res, 'This student account cannot be changed through that status transition', 409);
  }
  const map = { approve: 'ACTIVE', reject: 'REJECTED', suspend: 'SUSPENDED', reactivate: 'ACTIVE' };
  const updated = await prisma.user.update({ where: { id: userId }, data: { status: map[action] } });
  await audit({ actorId: req.user.id, action: `USER_${action.toUpperCase()}`, entity: 'User', entityId: userId, ipAddress: req.ip });
  if (updated.status !== 'ACTIVE') await revalidateLiveClassAccess();
  return ok(res, { id: updated.id, status: updated.status }, 'Updated');
};
