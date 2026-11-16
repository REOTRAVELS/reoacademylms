import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

const parseSender = (from) => {
  const displayName = /^\s*(.*?)\s*<([^<>]+)>\s*$/.exec(from);
  if (!displayName) return { email: from };
  return {
    name: displayName[1].replace(/^"|"$/g, ''),
    email: displayName[2],
  };
};

export const createBrevoTransport = ({ apiKey, fetchImpl = fetch }) => ({
  sendMail: async ({ from, to, subject, text }) => {
    const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(from),
        to: [{ email: to }],
        subject,
        textContent: text,
      }),
    });
    if (!response.ok) {
      throw new Error(`Brevo email request failed with status ${response.status}`);
    }
  },
});

const emailConfiguration = env.brevoApiKey && env.emailFrom
  ? {
    mailTransport: createBrevoTransport({ apiKey: env.brevoApiKey }),
    from: env.emailFrom,
  }
  : env.smtpUrl && env.smtpFrom
    ? {
      mailTransport: nodemailer.createTransport(env.smtpUrl),
      from: env.smtpFrom,
    }
    : null;

export const createEmailService = ({ mailTransport, from }) => ({
  sendPasswordResetEmail: async (email, resetUrl) => {
    await mailTransport.sendMail({
      from,
      to: email,
      subject: 'Reset your REO Travel Academy password',
      text: [
        'A password reset was requested for this email address.',
        '',
        `Use this link within one hour to choose a new password: ${resetUrl}`,
        '',
        'If you did not request a password reset, you can ignore this message.',
      ].join('\n'),
    });
  },
  sendTrainerInvitationEmail: async (email, invitationUrl, expiresAt) => {
    await mailTransport.sendMail({
      from,
      to: email,
      subject: 'You are invited to REO Travel Academy',
      text: [
        'You have been invited to join REO Travel Academy as a Trainer.',
        '',
        `Accept your invitation and set your password here: ${invitationUrl}`,
        `This one-time link expires on ${expiresAt.toLocaleString()}.`,
        '',
        'If you were not expecting this invitation, you can ignore this message.',
      ].join('\n'),
    });
  },
  sendStudentApplicationLinkEmail: async (email, applicationUrl) => {
    await mailTransport.sendMail({
      from,
      to: email,
      subject: 'Apply to REO Travel Academy',
      text: [
        'You have been invited to apply to REO Travel Academy.',
        '',
        `Review the available Programs and Intakes and submit your application here: ${applicationUrl}`,
        '',
        'Submitting an application does not create an active student account. Admission is subject to review.',
      ].join('\n'),
    });
  },
});

export const isEmailDeliveryConfigured = () => Boolean(emailConfiguration);

const emailService = emailConfiguration
  ? createEmailService(emailConfiguration)
  : null;

const requireEmailService = () => {
  if (!emailService) throw new Error('Email delivery is not configured');
  return emailService;
};

export const sendPasswordResetEmail = (...args) => (
  requireEmailService().sendPasswordResetEmail(...args)
);

export const sendTrainerInvitationEmail = (...args) => (
  requireEmailService().sendTrainerInvitationEmail(...args)
);

export const sendStudentApplicationLinkEmail = (...args) => (
  requireEmailService().sendStudentApplicationLinkEmail(...args)
);
