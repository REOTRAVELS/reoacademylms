import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrevoTransport, createEmailService } from '../src/services/emailService.js';

test('email service builds password reset, Trainer invitation, and student application emails', async () => {
  const messages = [];
  const emailService = createEmailService({
    mailTransport: { sendMail: async (message) => messages.push(message) },
    from: 'REO Academy <no-reply@example.test>',
  });
  const expiresAt = new Date('2027-01-08T12:00:00.000Z');

  await emailService.sendPasswordResetEmail(
    'person@example.test',
    'https://academy.example.test/reset-password?token=reset-token',
  );
  await emailService.sendTrainerInvitationEmail(
    'trainer@example.test',
    'https://academy.example.test/accept-invite/invite-token',
    expiresAt,
  );
  await emailService.sendStudentApplicationLinkEmail(
    'applicant@example.test',
    'https://academy.example.test/register',
  );

  assert.equal(messages.length, 3);
  assert.equal(messages[0].from, 'REO Academy <no-reply@example.test>');
  assert.equal(messages[0].to, 'person@example.test');
  assert.match(messages[0].text, /reset-password\?token=reset-token/);
  assert.equal(messages[1].to, 'trainer@example.test');
  assert.match(messages[1].subject, /invited/i);
  assert.match(messages[1].text, /accept-invite\/invite-token/);
  assert.match(messages[1].text, /2027/);
  assert.equal(messages[2].to, 'applicant@example.test');
  assert.match(messages[2].text, /\/register/);
  assert.match(messages[2].text, /does not create an active student account/);
});

test('Brevo transport sends transactional email over HTTPS with the verified sender', async () => {
  let request;
  const transport = createBrevoTransport({
    apiKey: 'brevo-test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 201 };
    },
  });

  await transport.sendMail({
    from: 'REO Academy <sender@example.test>',
    to: 'student@example.test',
    subject: 'Reset your password',
    text: 'Use this one-time link.',
  });

  assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['api-key'], 'brevo-test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    sender: { name: 'REO Academy', email: 'sender@example.test' },
    to: [{ email: 'student@example.test' }],
    subject: 'Reset your password',
    textContent: 'Use this one-time link.',
  });
});

test('Brevo transport surfaces provider failures', async () => {
  const transport = createBrevoTransport({
    apiKey: 'brevo-test-key',
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });

  await assert.rejects(
    transport.sendMail({
      from: 'sender@example.test',
      to: 'student@example.test',
      subject: 'Reset your password',
      text: 'Use this one-time link.',
    }),
    /Brevo email request failed with status 401/,
  );
});
