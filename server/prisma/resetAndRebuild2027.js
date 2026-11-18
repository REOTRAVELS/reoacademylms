import 'dotenv/config';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { validateCourseQuality } from '../src/utils/courseQuality.js';
import { env } from '../src/config/env.js';
import { signToken } from '../src/utils/jwt.js';

const prisma = new PrismaClient();
const confirmation = 'REBUILD_REO_ACADEMY_2027';
const backupPath = process.env.ACADEMIC_RESET_BACKUP;
const dryRun = process.argv.includes('--dry-run');
const execute = process.argv.includes('--execute');
const pgRestore = 'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_restore.exe';

const programs = [
  {
    title: 'Diploma in Travel Agency Management',
    slug: 'diploma-travel-agency-management',
    qualificationType: 'Diploma',
    description: 'Professional preparation for travel agency operations, itinerary design, supplier coordination, customer service, and responsible travel sales.',
    category: 'Travel Agency Management',
    targetAudience: 'Future travel consultants, agency supervisors, and travel operations coordinators.',
    objectives: [
      'Explain how travel agencies connect clients, suppliers, and destination services.',
      'Build accurate itineraries and reservation records for different traveler needs.',
      'Apply ethical sales, payment, privacy, and service-recovery practices.',
    ],
    outcomes: [
      'Prepare a documented itinerary that matches a client brief and supplier constraints.',
      'Calculate and explain a transparent travel quotation using approved pricing inputs.',
      'Resolve a booking disruption using a documented duty-of-care workflow.',
    ],
    references: [
      'https://www.iata.org/',
      'https://www.unwto.org/',
      'https://www.icao.int/',
    ],
    modules: [
      {
        title: 'Travel Industry and Agency Foundations',
        description: 'Understand the agency role, traveler requirements, and responsible handling of client information.',
        lessons: [
          {
            title: 'The travel agency value chain',
            body: 'A travel agency translates a traveler’s needs into coordinated services supplied by airlines, accommodation providers, ground operators, and destination partners. The consultant adds value through accurate advice, verified reservations, clear documentation, and continuing support rather than simply passing on a supplier link.',
            question: 'Which activity best demonstrates an agency’s coordinating role?',
            options: ['Issuing an unverified itinerary', 'Matching a client brief to confirmed supplier services', 'Replacing a supplier’s fare rules', 'Hiding a booking condition'],
            answer: 'Matching a client brief to confirmed supplier services',
            reference: 1,
          },
          {
            title: 'Traveler profiles and trip requirements',
            body: 'A useful client brief records purpose, dates, budget, party composition, accessibility needs, preferred pace, and non-negotiable constraints. Consultants confirm assumptions with the traveler and keep sensitive details limited to staff who need them to deliver the service.',
            question: 'What should a consultant do when a client’s accessibility requirement is unclear?',
            options: ['Assume the supplier will accommodate it', 'Ask a respectful clarifying question and confirm the service with the supplier', 'Remove the requirement from the file', 'Promise the service without checking'],
            answer: 'Ask a respectful clarifying question and confirm the service with the supplier',
            reference: 1,
          },
          {
            title: 'Duty of care and client records',
            body: 'Travel records should be accurate, access-controlled, and retained only as long as operational or legal obligations require. A duty-of-care workflow identifies who is affected, which supplier must be contacted, what alternatives exist, and how the traveler will receive timely updates.',
            question: 'Which practice best protects a traveler’s personal data?',
            options: ['Share the complete booking file with every supplier', 'Collect only necessary details and restrict access to authorized staff', 'Store payment details in an open spreadsheet', 'Send identity documents to an unrelated mailing list'],
            answer: 'Collect only necessary details and restrict access to authorized staff',
            reference: 2,
          },
        ],
      },
      {
        title: 'Travel Products, Itineraries, and Supplier Operations',
        description: 'Coordinate transport, accommodation, and ground services into feasible, documented travel plans.',
        lessons: [
          {
            title: 'Air itinerary and connection planning',
            body: 'An air itinerary must align dates, airports, operating carriers, passenger details, and ticket conditions. Connection planning also considers terminal changes, minimum connection times, baggage arrangements, visa requirements, and a realistic margin for disruption.',
            question: 'Before confirming a tight connection, what must a consultant verify?',
            options: ['Only the displayed arrival time', 'Operating airports, terminals, connection rules, and ticket conditions', 'The traveler’s social media profile', 'Whether the fare is the cheapest in any market'],
            answer: 'Operating airports, terminals, connection rules, and ticket conditions',
            reference: 0,
          },
          {
            title: 'Accommodation and ground-service matching',
            body: 'Accommodation and transfers should be selected against the trip purpose, location, accessibility needs, occupancy, check-in times, cancellation terms, and supplier confirmation. A comparison should disclose meaningful differences rather than treating unlike services as interchangeable.',
            question: 'Which detail is essential when matching a hotel to a late arrival?',
            options: ['The property’s social-media follower count', 'Confirmed late check-in arrangements and local arrival timing', 'The color of the lobby', 'An unrelated promotion code'],
            answer: 'Confirmed late check-in arrangements and local arrival timing',
            reference: 1,
          },
          {
            title: 'Reservations, confirmations, and change control',
            body: 'A reliable reservation record distinguishes requested, held, ticketed, and confirmed services. Changes are logged with a timestamp, supplier reference, cost impact, traveler approval, and updated documents so the operational team works from one current itinerary.',
            question: 'What should happen after a traveler approves a paid itinerary change?',
            options: ['Keep the original itinerary as the only record', 'Record the approval, supplier confirmation, cost, and revised documents', 'Delete the booking history', 'Assume all suppliers updated automatically'],
            answer: 'Record the approval, supplier confirmation, cost, and revised documents',
            reference: 0,
          },
        ],
      },
      {
        title: 'Consultative Sales, Finance, and Service Recovery',
        description: 'Price transparently, recommend suitable options, and support travelers when plans change.',
        lessons: [
          {
            title: 'Consultative travel selling',
            body: 'Consultative selling starts with questions about the traveler’s goals and constraints, then compares a short list of suitable options. A recommendation explains trade-offs, what is included, what remains unconfirmed, and the next decision needed from the client.',
            question: 'Which recommendation is most consistent with consultative selling?',
            options: ['The highest-commission product without explanation', 'A suitable option with clear benefits, constraints, and alternatives', 'A package selected before understanding the trip', 'A verbal guarantee that contradicts supplier terms'],
            answer: 'A suitable option with clear benefits, constraints, and alternatives',
            reference: 1,
          },
          {
            title: 'Transparent quotations and agency finance',
            body: 'A quotation should distinguish supplier charges, taxes, agency fees, optional services, payment deadlines, currency assumptions, and cancellation terms. Staff reconcile collected funds to supplier confirmations and follow approved controls for refunds and financial adjustments.',
            question: 'Why should a quotation show agency fees separately?',
            options: ['To make totals harder to compare', 'To support informed consent and transparent pricing', 'To avoid recording the supplier price', 'To remove cancellation terms'],
            answer: 'To support informed consent and transparent pricing',
            reference: 0,
          },
          {
            title: 'Disruption response and complaint resolution',
            body: 'When a service is disrupted, first establish verified facts, traveler safety, time-critical needs, and supplier responsibilities. Offer feasible alternatives, explain any cost or policy impact, obtain required approval, document decisions, and follow up until the traveler has a confirmed next step.',
            question: 'What is the best first response to an unverified disruption report?',
            options: ['Promise a refund immediately', 'Verify the situation and assess traveler safety and urgent needs', 'Close the case as resolved', 'Blame the traveler'],
            answer: 'Verify the situation and assess traveler safety and urgent needs',
            reference: 1,
          },
        ],
      },
    ],
    questions: [
      {
        prompt: 'A traveler requests an itinerary with an accessibility requirement. Which action should be completed before confirming the service?',
        options: ['Record it as a preference without supplier review', 'Verify the specific requirement and service with the supplier', 'Remove it to simplify the booking', 'Assume every supplier provides the same accommodation'],
        answer: 'Verify the specific requirement and service with the supplier',
      },
      {
        prompt: 'A confirmed air itinerary includes a terminal change. What should the consultant check?',
        options: ['Connection time and applicable airport transfer requirements', 'Only the ticket price', 'The hotel’s cancellation policy', 'The agency’s sales target'],
        answer: 'Connection time and applicable airport transfer requirements',
      },
      {
        prompt: 'Which record best supports controlled itinerary changes?',
        options: ['A verbal note with no timestamp', 'A dated change record with approval, supplier confirmation, and revised cost', 'A deleted copy of the original itinerary', 'An unverified message from another traveler'],
        answer: 'A dated change record with approval, supplier confirmation, and revised cost',
      },
      {
        prompt: 'What should a transparent quotation distinguish?',
        options: ['Supplier charges, agency fees, taxes, and key conditions', 'Only the final total', 'Only the consultant commission', 'Unconfirmed services as guaranteed items'],
        answer: 'Supplier charges, agency fees, taxes, and key conditions',
      },
      {
        prompt: 'During a service disruption, what is the most responsible first step?',
        options: ['Verify facts and assess safety and urgent traveler needs', 'Promise an unapproved refund', 'Close the case', 'Wait until the traveler contacts the agency again'],
        answer: 'Verify facts and assess safety and urgent traveler needs',
      },
    ],
  },
  {
    title: 'Certification in Customer Relations Management',
    slug: 'certification-customer-relations-management',
    qualificationType: 'Certification',
    description: 'Practical preparation for customer relationship management, service communication, complaint resolution, retention, and responsible use of customer data.',
    category: 'Customer Relations Management',
    targetAudience: 'Customer service representatives, team leads, and client relationship coordinators.',
    objectives: [
      'Map customer journeys and identify service moments that influence trust.',
      'Use clear listening and communication methods across service channels.',
      'Resolve complaints fairly and use feedback to improve customer outcomes.',
    ],
    outcomes: [
      'Document a customer journey with measurable service expectations.',
      'Respond to a complaint using an empathetic, evidence-based resolution plan.',
      'Recommend a retention improvement based on customer feedback and service data.',
    ],
    references: [
      'https://www.iso.org/iso-10001-customer-satisfaction.html',
      'https://www.instituteofcustomerservice.com/',
      'https://www.citizensadvice.org.uk/consumer/',
    ],
    modules: [
      {
        title: 'Customer Insight and Relationship Foundations',
        description: 'Understand relationship value, customer journeys, and accessible communication.',
        lessons: [
          {
            title: 'Relationship value and customer expectations',
            body: 'Customer relationships grow when an organization reliably delivers what it promises and explains constraints honestly. Relationship value includes trust, reduced effort, relevant support, and consistent treatment—not simply the volume of messages or discounts sent.',
            question: 'Which behavior most consistently builds customer trust?',
            options: ['Making promises beyond policy', 'Delivering clear commitments and explaining constraints honestly', 'Sending more messages regardless of relevance', 'Avoiding ownership of service problems'],
            answer: 'Delivering clear commitments and explaining constraints honestly',
            reference: 0,
          },
          {
            title: 'Customer journey mapping',
            body: 'A journey map follows the customer’s goal across discovery, purchase, service, and follow-up. It records customer actions, questions, emotions, hand-offs, and failure points so teams can improve the underlying process instead of treating each complaint as an isolated event.',
            question: 'What does a useful journey map make visible?',
            options: ['Only the organization chart', 'Customer actions, hand-offs, expectations, and points of friction', 'Only annual revenue', 'A list of staff birthdays'],
            answer: 'Customer actions, hand-offs, expectations, and points of friction',
            reference: 1,
          },
          {
            title: 'Inclusive and accessible service communication',
            body: 'Accessible communication adapts language, format, pace, and channel to the customer’s stated needs. Staff check understanding without blame, protect private information, and offer an accessible alternative when a standard channel creates a barrier.',
            question: 'How should a representative respond when a customer requests an accessible format?',
            options: ['Offer an appropriate format and confirm it meets the customer’s need', 'Require the customer to use the standard format', 'Share the request with unrelated teams', 'Assume the request is unnecessary'],
            answer: 'Offer an appropriate format and confirm it meets the customer’s need',
            reference: 2,
          },
        ],
      },
      {
        title: 'Service Communication and Complaint Resolution',
        description: 'Apply active listening, clear explanations, and fair complaint handling.',
        lessons: [
          {
            title: 'Active listening and question design',
            body: 'Active listening gives the customer space to explain the issue, then checks the representative’s understanding with a concise summary. Open questions establish impact and desired outcomes; focused follow-up questions gather the evidence needed to resolve the matter.',
            question: 'Which response demonstrates active listening?',
            options: ['Interrupting to offer a standard script', 'Summarizing the concern and asking whether the summary is accurate', 'Changing the topic to sales', 'Repeating a policy without hearing the issue'],
            answer: 'Summarizing the concern and asking whether the summary is accurate',
            reference: 1,
          },
          {
            title: 'Complaint ownership and fair resolution',
            body: 'A fair complaint process acknowledges impact, separates known facts from assumptions, checks the applicable policy, and gives the customer a named next step and realistic timeline. If the first representative cannot decide, ownership continues through a documented escalation.',
            question: 'What should a representative do when authority to decide a remedy is limited?',
            options: ['End the conversation without explanation', 'Explain the boundary and own a documented escalation with a timeline', 'Promise any remedy requested', 'Ask the customer to repeat the issue to every department'],
            answer: 'Explain the boundary and own a documented escalation with a timeline',
            reference: 2,
          },
          {
            title: 'Service recovery and follow-up',
            body: 'Service recovery confirms the agreed action was completed and checks whether the outcome addressed the customer’s concern. Follow-up also identifies process changes that could prevent repeat failures, while avoiding unnecessary contact or pressure to change a review.',
            question: 'What is the purpose of a service-recovery follow-up?',
            options: ['Confirm the agreed action and identify unresolved needs', 'Pressure the customer to withdraw feedback', 'Close a case before work is complete', 'Send promotional messages unrelated to the case'],
            answer: 'Confirm the agreed action and identify unresolved needs',
            reference: 0,
          },
        ],
      },
      {
        title: 'Retention, CRM Systems, and Measurement',
        description: 'Use customer data responsibly and measure relationship outcomes.',
        lessons: [
          {
            title: 'Retention through relevant customer value',
            body: 'Retention is strengthened by useful products, dependable service, and timely support that reflects a customer’s needs. Teams should distinguish genuine customer value from short-term incentives and avoid using pressure or misleading scarcity to influence a decision.',
            question: 'Which retention action is most customer-centered?',
            options: ['Offer relevant support based on a stated need', 'Create false urgency to prevent cancellation', 'Hide the cancellation process', 'Send the same offer repeatedly after refusal'],
            answer: 'Offer relevant support based on a stated need',
            reference: 1,
          },
          {
            title: 'CRM records and responsible data use',
            body: 'A CRM record should support the next legitimate service interaction with accurate, necessary, and current information. Role-based access, transparent purposes, retention limits, and secure handling reduce exposure and help customers exercise their rights.',
            question: 'Which customer-data practice is appropriate?',
            options: ['Collect all available personal details just in case', 'Keep only necessary, accurate data with access limited to authorized work', 'Export customer records to personal email', 'Reuse sensitive data for an unrelated purpose'],
            answer: 'Keep only necessary, accurate data with access limited to authorized work',
            reference: 2,
          },
          {
            title: 'Customer feedback and service metrics',
            body: 'A balanced service scorecard combines customer feedback with measures such as first-contact resolution, response time, repeat contacts, and complaint themes. Teams interpret results in context and use them to test improvements rather than rewarding behavior that shifts effort onto customers.',
            question: 'Why should service teams use more than one metric?',
            options: ['To make reporting harder', 'To balance customer outcomes with speed and operational context', 'To avoid listening to feedback', 'To reward short calls regardless of resolution'],
            answer: 'To balance customer outcomes with speed and operational context',
            reference: 0,
          },
        ],
      },
    ],
    questions: [
      {
        prompt: 'A journey map is most useful when it captures which elements?',
        options: ['Customer actions, expectations, hand-offs, and friction points', 'Only the company reporting structure', 'Only the final invoice', 'Only marketing campaign dates'],
        answer: 'Customer actions, expectations, hand-offs, and friction points',
      },
      {
        prompt: 'Which response is an example of active listening?',
        options: ['Summarize the concern and verify understanding', 'Interrupt with a sales offer', 'Repeat a policy without context', 'End the conversation quickly'],
        answer: 'Summarize the concern and verify understanding',
      },
      {
        prompt: 'When a remedy requires escalation, what should the representative provide?',
        options: ['A named next step and realistic timeline', 'A guarantee outside their authority', 'No further information', 'An unrelated promotion'],
        answer: 'A named next step and realistic timeline',
      },
      {
        prompt: 'Which CRM data practice best supports responsible service?',
        options: ['Keep accurate, necessary information with role-based access', 'Collect all possible data', 'Send records to a personal email account', 'Reuse sensitive data for unrelated marketing'],
        answer: 'Keep accurate, necessary information with role-based access',
      },
      {
        prompt: 'Why combine customer feedback with operational service measures?',
        options: ['To balance customer outcomes with service efficiency and context', 'To avoid reviewing complaints', 'To reward speed regardless of resolution', 'To replace customer feedback'],
        answer: 'To balance customer outcomes with service efficiency and context',
      },
    ],
  },
  {
    title: 'Certification in Human Resources Management',
    slug: 'certification-human-resources-management',
    qualificationType: 'Certification',
    description: 'Applied preparation for fair people operations, recruitment, onboarding, employee development, performance conversations, and confidential HR practice.',
    category: 'Human Resources Management',
    targetAudience: 'HR assistants, people-operations coordinators, and aspiring human resources practitioners.',
    objectives: [
      'Explain core HR responsibilities across the employee lifecycle.',
      'Use consistent, job-related methods for recruitment and onboarding.',
      'Support fair performance, development, and confidential record practices.',
    ],
    outcomes: [
      'Prepare a role profile and structured, job-related interview guide.',
      'Create an onboarding plan with clear responsibilities and check-ins.',
      'Document a performance conversation and development action using fair process.',
    ],
    references: [
      'https://www.ilo.org/',
      'https://www.cipd.org/',
      'https://www.acas.org.uk/',
    ],
    modules: [
      {
        title: 'HR Practice, Ethics, and Employment Relations',
        description: 'Understand the HR lifecycle, fair practice, and confidential employee records.',
        lessons: [
          {
            title: 'The employee lifecycle and HR operations',
            body: 'HR operations connect workforce planning, recruitment, employment administration, development, and respectful exit processes. Clear records and defined responsibilities help employees and managers understand decisions while keeping personal data appropriately protected.',
            question: 'Which approach best supports consistent HR operations?',
            options: ['Document responsibilities and apply the same approved process', 'Make undocumented exceptions for favored staff', 'Share employee files broadly', 'Rely on informal memory for all decisions'],
            answer: 'Document responsibilities and apply the same approved process',
            reference: 1,
          },
          {
            title: 'Fairness, inclusion, and employment practice',
            body: 'Fair HR practice uses job-related criteria, accessible processes, consistent evidence, and respectful treatment. HR staff should recognize bias risks, follow applicable law and policy, and escalate issues that require specialist advice rather than making unsupported promises.',
            question: 'Which selection criterion is most defensible?',
            options: ['A documented capability linked to the role', 'A personal similarity to the interviewer', 'An unsupported assumption about a candidate', 'A private characteristic unrelated to the work'],
            answer: 'A documented capability linked to the role',
            reference: 0,
          },
          {
            title: 'Confidential records and employee relations',
            body: 'Employee relations records should be factual, proportionate, access-controlled, and stored according to approved retention requirements. Staff distinguish observation from opinion, correct errors through established processes, and share details only with people who have a legitimate role.',
            question: 'Which note is most appropriate for an HR record?',
            options: ['A factual dated account relevant to the matter', 'A speculative judgment about personality', 'An unrelated rumor', 'A copy shared with the whole organization'],
            answer: 'A factual dated account relevant to the matter',
            reference: 2,
          },
        ],
      },
      {
        title: 'Talent Acquisition and Employee Onboarding',
        description: 'Plan role requirements, structured recruitment, candidate communication, and supported onboarding.',
        lessons: [
          {
            title: 'Workforce planning and role profiles',
            body: 'Workforce planning links service objectives to the skills, capacity, and timing a team requires. A role profile separates essential outcomes from desirable experience so recruitment remains focused on real work and candidates can assess the opportunity clearly.',
            question: 'What makes an essential role criterion useful?',
            options: ['It is directly related to a necessary job outcome', 'It reproduces the previous employee’s preferences', 'It excludes candidates without evidence', 'It is unrelated to the position'],
            answer: 'It is directly related to a necessary job outcome',
            reference: 1,
          },
          {
            title: 'Structured selection and interview evidence',
            body: 'Structured selection uses the same core questions and a transparent scoring guide for candidates applying to the same role. Interviewers record evidence against job-related criteria, provide reasonable adjustments, and keep candidate information confidential.',
            question: 'Why use a common scoring guide across candidates?',
            options: ['To compare job-related evidence consistently', 'To remove the need for evidence', 'To guarantee a preferred candidate wins', 'To ask each candidate unrelated questions'],
            answer: 'To compare job-related evidence consistently',
            reference: 2,
          },
          {
            title: 'Onboarding plans and early support',
            body: 'Onboarding introduces role expectations, colleagues, systems, safety practices, and organizational values over a planned period. A manager assigns owners for each task and schedules check-ins so the new employee can ask questions and receive timely support.',
            question: 'What is a useful onboarding control?',
            options: ['Assign owners and scheduled check-ins for key onboarding steps', 'Leave all learning to informal guesswork', 'Delay access to essential role information indefinitely', 'Skip safety and policy orientation'],
            answer: 'Assign owners and scheduled check-ins for key onboarding steps',
            reference: 1,
          },
        ],
      },
      {
        title: 'Performance, Development, and People Analytics',
        description: 'Support clear objectives, constructive performance dialogue, development, and responsible workforce reporting.',
        lessons: [
          {
            title: 'Objectives and continuous performance dialogue',
            body: 'Useful objectives describe outcomes, measures, timeframes, and the support or authority needed to achieve them. Regular conversations review evidence, remove barriers, recognize progress, and update expectations when work priorities change.',
            question: 'Which objective is easiest to review fairly?',
            options: ['A specific outcome with a measure and timeframe', 'A vague instruction to work harder', 'An undocumented personal preference', 'A target outside the employee’s control'],
            answer: 'A specific outcome with a measure and timeframe',
            reference: 1,
          },
          {
            title: 'Development planning and capability building',
            body: 'Development planning connects an employee’s goals and capability needs with practical learning, supported experience, and review dates. A plan names the opportunity, the manager’s support, the employee’s next action, and evidence that learning has transferred into work.',
            question: 'What makes a development plan actionable?',
            options: ['Named actions, support, timing, and evidence of progress', 'A course link with no discussion', 'A promise of promotion', 'An objective unrelated to the role'],
            answer: 'Named actions, support, timing, and evidence of progress',
            reference: 1,
          },
          {
            title: 'People metrics and responsible interpretation',
            body: 'People analytics turns appropriately governed workforce data into questions about capacity, retention, development, and employee experience. Analysts define measures, protect small or sensitive groups, examine context, and avoid treating correlation as proof of cause.',
            question: 'What should an HR analyst do before sharing a small-group metric?',
            options: ['Check privacy and re-identification risk under approved rules', 'Publish names to make the metric actionable', 'Assume all correlations prove cause', 'Remove the metric definition'],
            answer: 'Check privacy and re-identification risk under approved rules',
            reference: 0,
          },
        ],
      },
    ],
    questions: [
      {
        prompt: 'Which criterion should guide a fair candidate assessment?',
        options: ['Documented evidence linked to an essential job outcome', 'Personal similarity to the interviewer', 'An undocumented assumption', 'A characteristic unrelated to the work'],
        answer: 'Documented evidence linked to an essential job outcome',
      },
      {
        prompt: 'Why use a structured interview guide?',
        options: ['To compare job-related evidence consistently', 'To avoid recording evidence', 'To guarantee a particular outcome', 'To ask unrelated questions'],
        answer: 'To compare job-related evidence consistently',
      },
      {
        prompt: 'What should an onboarding plan include?',
        options: ['Assigned owners, role information, and scheduled check-ins', 'Only an informal welcome message', 'No safety or policy information', 'Untracked tasks with no owner'],
        answer: 'Assigned owners, role information, and scheduled check-ins',
      },
      {
        prompt: 'Which performance objective is most reviewable?',
        options: ['A specific outcome with a measure and timeframe', 'A vague request to improve', 'An undocumented preference', 'A target beyond the employee’s control'],
        answer: 'A specific outcome with a measure and timeframe',
      },
      {
        prompt: 'What should be checked before publishing a small-group workforce metric?',
        options: ['Privacy and re-identification risk', 'Whether employee names can be added', 'Whether correlation proves causation', 'Whether the metric definition can be omitted'],
        answer: 'Privacy and re-identification risk',
      },
    ],
  },
];

const intakeCalendar = [
  { gateNumber: 1, season: 'WINTER', academicStart: '2027-01-15T09:00:00.000Z', academicEnd: '2027-03-31' },
  { gateNumber: 2, season: 'SPRING', academicStart: '2027-04-15T09:00:00.000Z', academicEnd: '2027-06-30' },
  { gateNumber: 3, season: 'SUMMER', academicStart: '2027-07-15T09:00:00.000Z', academicEnd: '2027-09-30' },
  { gateNumber: 4, season: 'FALL', academicStart: '2027-10-15T09:00:00.000Z', academicEnd: '2027-12-31' },
];

const toUtcDate = (date) => new Date(`${date}T00:00:00.000Z`);
const endOfUtcDate = (date) => {
  const dateOnly = date instanceof Date ? date.toISOString().slice(0, 10) : date;
  return new Date(`${dateOnly}T23:59:59.999Z`);
};

const counts = async (database) => {
  const [
    superAdmins, students, tutors, programmes, intakes, offerings, cohorts, courses,
    modules, lessons, assessments, examinations, questions, enrollments, cohortEnrollments,
    auditLogs,
  ] = await Promise.all([
    database.user.count({ where: { role: { name: 'SUPER_ADMIN' } } }),
    database.user.count({ where: { role: { name: 'STUDENT' } } }),
    database.user.count({ where: { role: { name: 'TRAINER' } } }),
    database.programme.count(),
    database.intake.count(),
    database.intakeProgramOffering.count(),
    database.cohort.count(),
    database.course.count(),
    database.module.count(),
    database.lesson.count(),
    database.assessment.count({ where: { type: 'ASSESSMENT' } }),
    database.assessment.count({ where: { type: 'EXAMINATION' } }),
    database.question.count(),
    database.programEnrollment.count(),
    database.enrolment.count(),
    database.auditLog.count(),
  ]);
  return {
    superAdmins, students, tutors, programmes, intakes, offerings, cohorts, courses,
    modules, lessons, assessments, examinations, questions, programEnrollments: enrollments,
    cohortEnrollments, auditLogs,
  };
};

const ensureBackup = () => {
  if (!backupPath || !fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error('Set ACADEMIC_RESET_BACKUP to a verified, non-empty custom-format backup.');
  }
  const catalog = spawnSync(pgRestore, ['--list', backupPath], { stdio: 'ignore' });
  const fullRead = spawnSync(pgRestore, ['--exit-on-error', '--file', 'NUL', backupPath], { stdio: 'ignore' });
  if (catalog.error || catalog.status !== 0 || fullRead.error || fullRead.status !== 0) {
    throw new Error('The configured database backup did not pass archive verification.');
  }
};

const deleteAcademicData = async (database) => {
  await database.courseDiscussionModeration.deleteMany();
  await database.courseDiscussionReport.deleteMany();
  await database.courseDiscussionPost.deleteMany();
  await database.assessmentAnswer.deleteMany();
  await database.assessmentAttempt.deleteMany();
  await database.question.deleteMany();
  await database.assessment.deleteMany();
  await database.grade.deleteMany();
  await database.submission.deleteMany();
  await database.assignment.deleteMany();
  await database.liveClassRecording.deleteMany();
  await database.liveClassCorrection.deleteMany();
  await database.liveClassEngagement.deleteMany();
  await database.liveClassInteraction.deleteMany();
  await database.liveClassPresence.deleteMany();
  await database.liveClass.deleteMany();
  await database.attendance.deleteMany();
  await database.lessonProgress.deleteMany();
  await database.certificate.deleteMany();
  await database.announcement.deleteMany();
  await database.notificationClassificationHistory.deleteMany();
  await database.notification.deleteMany();
  await database.programEnrollmentAssignmentHistory.deleteMany();
  await database.programApplicationStatusHistory.deleteMany();
  await database.programEnrollment.deleteMany();
  await database.programApplication.deleteMany();
  await database.enrolment.deleteMany();
  await database.invitation.deleteMany();
  await database.courseTrainer.deleteMany();
  await database.cohortTrainer.deleteMany();
  await database.cohortCourse.deleteMany();
  await database.resource.deleteMany();
  await database.course.deleteMany();
  await database.cohort.deleteMany();
  await database.intakeProgramOffering.deleteMany();
  await database.intake.deleteMany();
  await database.programme.deleteMany();
  await database.user.deleteMany({ where: { role: { name: { in: ['STUDENT', 'TRAINER'] } } } });
};

const createCourseStructure = async (database, programme, cohortIds, academicEnd) => {
  const course = await database.course.create({
    data: {
      title: programme.title,
      subtitle: `${programme.qualificationType} · REO Travel Academy`,
      slug: programme.slug,
      description: programme.description,
      introduction: `This ${programme.qualificationType.toLowerCase()} develops practical capability in ${programme.category.toLowerCase()} through applied case work, structured content, and knowledge checks.`,
      category: programme.category,
      difficulty: 'Beginner to Intermediate',
      language: 'English',
      estimatedDuration: '36 hours',
      courseCode: `REO-${programme.slug.toUpperCase().replaceAll('-', '-')}`,
      learningObjectives: JSON.stringify(programme.objectives),
      learningOutcomes: JSON.stringify(programme.outcomes),
      targetAudience: programme.targetAudience,
      prerequisites: 'No prior qualification is required; learners should be ready to complete the applied practice activities.',
      prerequisitesMode: 'none',
      requirements: 'Internet access and a device capable of viewing course materials.',
      startDate: new Date('2027-01-15T09:00:00.000Z'),
      endDate: endOfUtcDate(academicEnd),
      visibility: 'cohort',
      completionRequirements: JSON.stringify({
        minimumLessonCompletionPercent: 100,
        requireAssessment: true,
        requireThumbnail: false,
      }),
      status: 'DRAFT',
      programmeId: programme.id,
    },
  });

  for (const [modulePosition, moduleInfo] of programme.modules.entries()) {
    const module = await database.module.create({
      data: {
        courseId: course.id,
        title: moduleInfo.title,
        description: moduleInfo.description,
        position: modulePosition,
      },
    });
    for (const [lessonPosition, lessonInfo] of moduleInfo.lessons.entries()) {
      const blocks = [
        { type: 'rich_text', content: lessonInfo.body },
        {
          type: 'link',
          content: programme.references[lessonInfo.reference],
          title: `Further reading: ${programme.category}`,
        },
        {
          type: 'knowledge_check',
          content: lessonInfo.question,
          options: lessonInfo.options,
          correctAnswer: lessonInfo.answer,
          explanation: `The correct choice is “${lessonInfo.answer}” because it follows the practice described in this lesson.`,
        },
      ];
      await database.lesson.create({
        data: {
          moduleId: module.id,
          title: lessonInfo.title,
          type: 'TEXT',
          content: JSON.stringify(blocks),
          position: lessonPosition,
          isPublished: true,
          objectives: JSON.stringify([lessonInfo.question]),
          outcomes: JSON.stringify([`Apply the ${lessonInfo.title.toLowerCase()} practice to a realistic workplace case.`]),
          estimatedDuration: '20 minutes',
        },
      });
    }
  }

  for (const cohortId of cohortIds) {
    await database.cohortCourse.create({ data: { courseId: course.id, cohortId } });
  }

  return course;
};

const createAssessmentSet = async (database, course, programme, offering, intake) => {
  const start = offering.academicStartDate;
  const end = endOfUtcDate(offering.academicEndDate);
  const examStart = new Date(end.getTime() - (14 * 24 * 60 * 60 * 1000));
  const createQuestions = () => programme.questions.map((question, position) => ({
    type: 'MULTIPLE_CHOICE',
    prompt: question.prompt,
    points: 2,
    position,
    options: question.options,
    correctAnswer: question.answer,
    explanation: `The correct answer is “${question.answer}”.`,
  }));
  const assessmentTitle = `${programme.category} · GATE ${String(intake.gateNumber).padStart(2, '0')} · Applied Assessment`;
  const examTitle = `${programme.category} · GATE ${String(intake.gateNumber).padStart(2, '0')} · Final Examination`;

  await database.assessment.create({
    data: {
      courseId: course.id,
      programOfferingId: offering.id,
      type: 'ASSESSMENT',
      title: assessmentTitle,
      description: `Applied knowledge check for ${programme.title} learners in ${intake.season} 2027.`,
      instructions: 'Complete each question independently. Your score is calculated when you submit. Review the course lessons before using an attempt.',
      timeLimitMin: 30,
      attemptLimit: 2,
      passMarkPercent: 60,
      status: 'PUBLISHED',
      availableFrom: start,
      availableTo: end,
      questions: { create: createQuestions() },
    },
  });

  await database.assessment.create({
    data: {
      courseId: course.id,
      programOfferingId: offering.id,
      type: 'EXAMINATION',
      resultsReleased: false,
      title: examTitle,
      description: `Scheduled final examination for ${programme.title} learners in ${intake.season} 2027.`,
      instructions: 'This is a timed final examination. Submit once when ready; the score is recorded for administration and remains hidden from students until an authorized administrator releases it.',
      timeLimitMin: 90,
      attemptLimit: 1,
      passMarkPercent: 60,
      status: 'PUBLISHED',
      availableFrom: examStart,
      availableTo: end,
      questions: { create: createQuestions() },
    },
  });
};

const createAcademicStructure = async (database, superAdminIds) => {
  const intakes = [];
  for (const entry of intakeCalendar) {
    const intake = await database.intake.create({
      data: {
        gateNumber: entry.gateNumber,
        season: entry.season,
        year: 2027,
        timezone: 'UTC',
        admissionsOpen: true,
        status: 'UPCOMING',
      },
    });
    intakes.push({ intake, calendar: entry });
  }

  const programmes = [];
  for (const programInfo of programs) {
    programmes.push(await database.programme.create({
      data: {
        title: programInfo.title,
        slug: programInfo.slug,
        description: programInfo.description,
        qualificationType: programInfo.qualificationType,
        status: 'ACTIVE',
      },
    }));
  }

  const cohortIdsByProgramme = new Map(programmes.map((programme) => [programme.id, []]));
  const offeringEntries = [];
  for (const { intake, calendar } of intakes) {
    for (const programme of programmes) {
      const offering = await database.intakeProgramOffering.create({
        data: {
          intakeId: intake.id,
          programmeId: programme.id,
          academicStartDate: new Date(calendar.academicStart),
          academicEndDate: toUtcDate(calendar.academicEnd),
          status: 'ACTIVE',
        },
      });
      const cohort = await database.cohort.create({
        data: {
          name: `GATE ${String(intake.gateNumber).padStart(2, '0')} · ${intake.season} 2027 · ${programme.title}`,
          programmeId: programme.id,
          intakeProgramOfferingId: offering.id,
          startDate: offering.academicStartDate,
          endDate: endOfUtcDate(offering.academicEndDate),
          status: 'PLANNED',
        },
      });
      cohortIdsByProgramme.get(programme.id).push(cohort.id);
      offeringEntries.push({ intake, programme, offering });
    }
  }

  const courses = [];
  for (const programme of programmes) {
    const definition = programs.find((item) => item.slug === programme.slug);
    const programmeEntries = offeringEntries.filter((entry) => entry.programme.id === programme.id);
    const course = await createCourseStructure(
      database,
      { ...definition, id: programme.id },
      cohortIdsByProgramme.get(programme.id),
      '2027-12-31',
    );
    for (const entry of programmeEntries) {
      await createAssessmentSet(database, course, definition, entry.offering, entry.intake);
    }
    const builderRecord = await database.course.findUnique({
      where: { id: course.id },
      include: {
        programme: true,
        modules: { include: { lessons: { include: { resources: true } } } },
        trainers: { include: { trainer: true } },
        resources: true,
        cohorts: { include: { cohort: true } },
        assessments: { include: { questions: true } },
      },
    });
    const quality = validateCourseQuality(builderRecord);
    if (!quality.valid) {
      throw new Error(`Course quality blocked ${programme.title}: ${JSON.stringify(quality.errors)}`);
    }
    courses.push({ id: course.id, title: course.title, warningCount: quality.warnings.length });
  }

  const initialAuditCount = await database.auditLog.count();
  if (superAdminIds.length) {
    await database.auditLog.create({
      data: {
        actorId: superAdminIds[0],
        action: 'ACADEMIC_RESET_AND_REBUILD_2027',
        entity: 'AcademicEnvironment',
        metadata: {
          preservedSuperAdminCount: superAdminIds.length,
          preservedAuditLogCountBeforeReset: initialAuditCount,
          intakes: 4,
          programmes: 3,
          offerings: 12,
          courses: 3,
          assessments: 12,
          examinations: 12,
        },
      },
    });
  }

  return { courseIds: courses.map(({ id }) => id), courses };
};

const verifyAcademicStructure = async (database) => {
  const [intakes, offerings, courses] = await Promise.all([
    database.intake.findMany({
      select: {
        gateNumber: true,
        season: true,
        year: true,
        programOfferings: { select: { programme: { select: { slug: true } } } },
      },
      orderBy: { gateNumber: 'asc' },
    }),
    database.intakeProgramOffering.findMany({
      select: {
        programmeId: true,
        assessments: {
          select: {
            type: true,
            course: { select: { programmeId: true } },
            questions: { select: { id: true } },
          },
        },
      },
    }),
    database.course.findMany({
      select: {
        programmeId: true,
        cohorts: {
          select: {
            cohort: { select: { intakeProgramOfferingId: true } },
          },
        },
      },
    }),
  ]);
  const expectedSlugs = new Set(programs.map(({ slug }) => slug));
  if (intakes.length !== 4 || intakes.some((intake, index) => (
    intake.gateNumber !== index + 1
      || intake.year !== 2027
      || intake.season !== intakeCalendar[index].season
      || intake.programOfferings.length !== 3
      || new Set(intake.programOfferings.map(({ programme }) => programme.slug)).size !== 3
      || intake.programOfferings.some(({ programme }) => !expectedSlugs.has(programme.slug))
  ))) {
    throw new Error('Each 2027 Intake must offer exactly the three official Programs.');
  }
  if (offerings.length !== 12 || offerings.some((offering) => (
    offering.assessments.length !== 2
      || new Set(offering.assessments.map(({ type }) => type)).size !== 2
      || offering.assessments.some((assessment) => (
        assessment.questions.length !== 5
          || assessment.course.programmeId !== offering.programmeId
      ))
  ))) {
    throw new Error('Each Program Offering must have its matching course assessment and examination.');
  }
  if (courses.length !== 3 || courses.some((course) => (
    new Set(course.cohorts.map(({ cohort }) => cohort.intakeProgramOfferingId)).size !== 4
  ))) {
    throw new Error('Each Program course must be assigned to its four Intake cohorts.');
  }
};

const publishCoursesThroughApi = async (courseIds, adminId) => {
  const { default: app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  try {
    const address = server.address();
    const token = signToken({ sub: adminId });
    for (const courseId of courseIds) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/courses/${courseId}/publish`, {
        method: 'POST',
        headers: { Cookie: `${env.cookieName}=${token}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(`Course publication failed (${response.status}): ${body.message || 'quality validation rejected the course'}`);
      }
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

class DryRunRollback extends Error {
  constructor(result) {
    super('Dry run rolled back');
    this.result = result;
  }
}

const main = async () => {
  if (!dryRun && !execute) {
    throw new Error('Pass --dry-run to validate the planned reset or --execute to perform it.');
  }
  if (!dryRun && process.env.ACADEMIC_RESET_CONFIRM !== confirmation) {
    throw new Error(`Set ACADEMIC_RESET_CONFIRM=${confirmation} to authorize execution.`);
  }
  ensureBackup();

  const [{ name: databaseName }] = await prisma.$queryRaw`SELECT current_database() AS name`;
  if (databaseName !== 'reo_academy') throw new Error('Refusing to modify a database other than reo_academy.');

  const before = await counts(prisma);
  const expectedBefore = {
    superAdmins: 1,
    students: 5,
    tutors: 2,
    programmes: 3,
    intakes: 0,
    offerings: 0,
    cohorts: 6,
    courses: 6,
    modules: 4,
    lessons: 4,
    assessments: 8,
    examinations: 0,
    questions: 11,
    programEnrollments: 0,
    cohortEnrollments: 6,
    auditLogs: 215,
  };
  if (JSON.stringify(before) !== JSON.stringify(expectedBefore)) {
    throw new Error(`Database changed since the reset inventory; refusing to reset: ${JSON.stringify(before)}`);
  }
  const superAdmins = await prisma.user.findMany({
    where: { role: { name: 'SUPER_ADMIN' } },
    select: { id: true },
  });
  if (!superAdmins.length) throw new Error('Refusing to reset academic data without a preserved Super Admin.');

  if (dryRun) {
    try {
      await prisma.$transaction(async (transaction) => {
        await deleteAcademicData(transaction);
        const created = await createAcademicStructure(transaction, superAdmins.map(({ id }) => id));
        const after = await counts(transaction);
        await verifyAcademicStructure(transaction);
        if (after.students !== 0 || after.tutors !== 0 || after.questions !== 120
          || after.programmes !== 3 || after.intakes !== 4 || after.offerings !== 12
          || after.courses !== 3 || after.modules !== 9 || after.lessons !== 27
          || after.assessments !== 12 || after.examinations !== 12
          || after.programEnrollments !== 0 || after.cohortEnrollments !== 0) {
          throw new Error(`Dry-run count verification failed: ${JSON.stringify(after)}`);
        }
        throw new DryRunRollback({ before, after, plannedCourseCount: created.courses.length });
      }, { timeout: 120000, maxWait: 10000 });
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
      console.log(JSON.stringify({
        mode: 'dry-run',
        rolledBack: true,
        before: error.result.before,
        plannedCounts: error.result.after,
        plannedCourseCount: error.result.plannedCourseCount,
      }));
      return;
    }
  }

  const created = await prisma.$transaction(async (transaction) => {
    await deleteAcademicData(transaction);
    const structure = await createAcademicStructure(transaction, superAdmins.map(({ id }) => id));
    const after = await counts(transaction);
    if (after.superAdmins !== before.superAdmins
      || after.students !== 0
      || after.tutors !== 0
      || after.programmes !== 3
      || after.intakes !== 4
      || after.offerings !== 12
      || after.cohorts !== 12
      || after.courses !== 3
      || after.modules !== 9
      || after.lessons !== 27
      || after.assessments !== 12
      || after.examinations !== 12
      || after.questions !== 120
      || after.programEnrollments !== 0
      || after.cohortEnrollments !== 0
      || after.auditLogs < before.auditLogs + 1) {
      throw new Error(`Post-reset count verification failed: ${JSON.stringify(after)}`);
    }
    await verifyAcademicStructure(transaction);
    return { ...structure, after };
  }, { timeout: 120000, maxWait: 10000 });

  await publishCoursesThroughApi(created.courseIds, superAdmins[0].id);
  const finalCounts = await counts(prisma);
  if (finalCounts.courses !== 3 || finalCounts.students !== 0 || finalCounts.tutors !== 0) {
    throw new Error(`Final verification failed after course publication: ${JSON.stringify(finalCounts)}`);
  }
  const publishedCourses = await prisma.course.count({ where: { status: 'PUBLISHED' } });
  if (publishedCourses !== 3) throw new Error('Not all rebuilt courses were published through the course API.');
  console.log(JSON.stringify({
    mode: 'execute',
    before,
    after: finalCounts,
    publishedCourses,
    courseWarnings: created.courses.map(({ title, warningCount }) => ({ title, warningCount })),
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error.message || 'Academic reset failed.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
