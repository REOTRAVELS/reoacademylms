import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, ClipboardCheck, Clock3, Plus, Trash2 } from 'lucide-react';
import { assessmentsAPI, cohortsAPI, coursesAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Input, Select, Textarea } from '../../components/forms/Input';
import { formatRemainingTime, getRemainingSeconds } from './attemptTime';
import { getAssessmentAvailability } from './assessmentAvailability';

const questionTypes = [
  { value: 'MULTIPLE_CHOICE', label: 'Multiple choice' },
  { value: 'MULTIPLE_ANSWER', label: 'Select all that apply' },
  { value: 'TRUE_FALSE', label: 'True or false' },
  { value: 'SHORT_ANSWER', label: 'Short answer' },
];

const newQuestion = { type: 'MULTIPLE_CHOICE', prompt: '', points: 1, options: '', correctAnswer: '' };
const newAssessment = {
  title: '',
  description: '',
  instructions: '',
  courseId: '',
  programOfferingId: '',
  type: 'ASSESSMENT',
  timeLimitMin: '',
  attemptLimit: 1,
  passMarkPercent: 50,
  availableFrom: '',
  availableTo: '',
  status: 'DRAFT',
};
const datePayload = (value) => value ? new Date(value).toISOString() : null;

export default function AssessmentsPage() {
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const canManage = role === 'SUPER_ADMIN' || role === 'TRAINER';
  const isAdmin = role === 'SUPER_ADMIN';
  const [assessments, setAssessments] = useState([]);
  const [courses, setCourses] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(newAssessment);
  const [activeAssessment, setActiveAssessment] = useState(null);
  const [questionForm, setQuestionForm] = useState(newQuestion);
  const [editingAssessment, setEditingAssessment] = useState(null);
  const [activeAttempt, setActiveAttempt] = useState(null);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [reviewBeforeSubmit, setReviewBeforeSubmit] = useState(false);
  const [clockNow, setClockNow] = useState(Date.now());
  const [attemptReview, setAttemptReview] = useState(null);
  const [gradeDraft, setGradeDraft] = useState({});
  const [feedbackDraft, setFeedbackDraft] = useState({});
  const [studentAttemptReview, setStudentAttemptReview] = useState(null);
  const [releasingAttemptId, setReleasingAttemptId] = useState(null);
  const expirySubmissionRef = useRef(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const cohortRequest = canManage ? cohortsAPI.list() : Promise.resolve({ data: { data: [] } });
      const [assessmentResponse, courseResponse, attemptResponse, cohortResponse] = await Promise.all([
        assessmentsAPI.list(),
        coursesAPI.list(),
        assessmentsAPI.listAttempts(),
        cohortRequest,
      ]);
      setAssessments(assessmentResponse.data.data || []);
      setCourses(courseResponse.data.data || []);
      setAttempts(attemptResponse.data.data || []);
      setCohorts(cohortResponse.data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load assessments.');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => { loadPage(); }, [loadPage]);

  useEffect(() => {
    if (!activeAttempt) return undefined;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeAttempt]);

  const handleCreateAssessment = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await assessmentsAPI.create({
        ...form,
        programOfferingId: form.programOfferingId || null,
        timeLimitMin: form.timeLimitMin ? Number(form.timeLimitMin) : null,
        attemptLimit: Number(form.attemptLimit),
        passMarkPercent: Number(form.passMarkPercent),
        availableFrom: datePayload(form.availableFrom),
        availableTo: datePayload(form.availableTo),
      });
      setForm(newAssessment);
      setShowForm(false);
      setNotice('Assessment created. Add questions before publishing it for students.');
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create assessment.');
    } finally {
      setSaving(false);
    }
  };

  const openAssessmentEditor = async (assessment) => {
    setError('');
    try {
      const { data } = await assessmentsAPI.get(assessment.id);
      setEditingAssessment(data.data);
      setQuestionForm(newQuestion);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not open assessment questions.');
    }
  };

  const saveQuestion = async (event) => {
    event.preventDefault();
    if (!editingAssessment) return;
    setSaving(true);
    setError('');
    try {
      const options = questionForm.options.split('\n').map((option) => option.trim()).filter(Boolean);
      let correctAnswer = questionForm.correctAnswer.trim();
      if (questionForm.type === 'MULTIPLE_ANSWER') {
        correctAnswer = correctAnswer.split(',').map((answer) => answer.trim()).filter(Boolean);
      } else if (questionForm.type !== 'SHORT_ANSWER') {
        correctAnswer = correctAnswer;
      } else {
        correctAnswer = null;
      }
      await assessmentsAPI.addQuestion(editingAssessment.id, {
        type: questionForm.type,
        prompt: questionForm.prompt,
        points: Number(questionForm.points),
        options: options.length ? options : undefined,
        correctAnswer,
      });
      const { data } = await assessmentsAPI.get(editingAssessment.id);
      setEditingAssessment(data.data);
      setQuestionForm(newQuestion);
      setNotice('Question added.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not add this question.');
    } finally {
      setSaving(false);
    }
  };

  const deleteQuestion = async (question) => {
    if (!window.confirm('Delete this question?')) return;
    try {
      await assessmentsAPI.deleteQuestion(question.id);
      const { data } = await assessmentsAPI.get(editingAssessment.id);
      setEditingAssessment(data.data);
      setNotice('Question deleted.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete the question.');
    }
  };

  const changeAssessmentStatus = async (assessment, status) => {
    setError('');
    try {
      await assessmentsAPI.update(assessment.id, { status });
      setNotice(`${assessment.type === 'EXAMINATION' ? 'Examination' : 'Assessment'} ${status.toLowerCase()}.`);
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update assessment.');
    }
  };

  const changeResultsVisibility = async (assessment, resultsReleased) => {
    setError('');
    if (resultsReleased && !window.confirm(`Release results for "${assessment.title}" to students?`)) return;
    try {
      await assessmentsAPI.update(assessment.id, { resultsReleased });
      setNotice(resultsReleased ? 'Examination results released to students.' : 'Examination results hidden from students.');
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update examination result visibility.');
    }
  };

  const releaseAttemptResult = async (attempt) => {
    if (!window.confirm(`Release the examination result for ${attempt.student?.firstName || 'this learner'}?`)) return;
    setError('');
    setReleasingAttemptId(attempt.id);
    try {
      await assessmentsAPI.releaseAttemptResults(attempt.id);
      setNotice('Examination result released to the learner.');
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not release the examination result.');
    } finally {
      setReleasingAttemptId(null);
    }
  };

  const deleteAssessment = async (assessment) => {
    if (!window.confirm(`Delete "${assessment.title}" and its questions and attempts? This cannot be undone.`)) return;
    try {
      await assessmentsAPI.delete(assessment.id);
      setNotice('Assessment deleted.');
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete assessment.');
    }
  };

  const beginAttempt = async (assessment, existingAttempt = null) => {
    setError('');
    try {
      if (existingAttempt) {
        const { data } = await assessmentsAPI.getAttempt(existingAttempt.id);
        setActiveAssessment(data.data.assessment);
        setActiveAttempt(data.data);
        setQuizAnswers(Object.fromEntries(data.data.answers.map((answer) => [answer.questionId, answer.answer])));
        setCurrentQuestionIndex(0);
        setReviewBeforeSubmit(false);
        setClockNow(Date.now());
        return;
      }
      const assessmentResponse = await assessmentsAPI.get(assessment.id);
      const attemptResponse = await assessmentsAPI.startAttempt(assessment.id);
      setActiveAssessment(assessmentResponse.data.data);
      setActiveAttempt(attemptResponse.data.data);
      setQuizAnswers({});
      setCurrentQuestionIndex(0);
      setReviewBeforeSubmit(false);
      setClockNow(Date.now());
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not start this assessment.');
    }
  };

  const saveAttemptAnswers = async () => {
    await Promise.all(activeAssessment.questions
      .filter((question) => quizAnswers[question.id] !== undefined)
      .map((question) => assessmentsAPI.saveAnswer({
        attemptId: activeAttempt.id,
        questionId: question.id,
        answer: quizAnswers[question.id],
      })));
  };

  const persistAnswer = async (questionId, answer) => {
    if (answer === undefined || answer === null || !canEditAttempt) return;
    try {
      await assessmentsAPI.saveAnswer({ attemptId: activeAttempt.id, questionId, answer });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save your answer.');
    }
  };

  const leaveAttempt = async () => {
    setSaving(true);
    setError('');
    try {
      if (canEditAttempt) {
        await saveAttemptAnswers();
      }
      setActiveAttempt(null);
      setActiveAssessment(null);
      setReviewBeforeSubmit(false);
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save your answers before leaving.');
    } finally {
      setSaving(false);
    }
  };

  const setAnswer = (questionId, answer) => {
    setQuizAnswers((current) => ({ ...current, [questionId]: answer }));
  };

  const submitAttempt = async () => {
    setSaving(true);
    setError('');
    try {
      if (canEditAttempt) {
        await saveAttemptAnswers();
      }
      const { data } = await assessmentsAPI.submitAttempt(activeAttempt.id);
      const examResultsHeld = data.data.assessment.type === 'EXAMINATION'
        && !data.data.assessment.resultsReleased
        && !data.data.resultsReleasedAt;
      const scoreMessage = examResultsHeld
        ? 'Your examination was submitted. Results will be available after an administrator releases them.'
        : data.data.score === null
        ? 'Your answers are awaiting Tutor review.'
        : `Your score is ${data.data.score}/${data.data.maxScore}${data.data.passed === null ? '' : data.data.passed ? ' — passed' : ' — below the pass mark'}.`;
      setNotice(`${activeAssessment.type === 'EXAMINATION' ? 'Examination' : 'Assessment'} submitted. ${scoreMessage}`);
      setActiveAssessment(null);
      setActiveAttempt(null);
      setReviewBeforeSubmit(false);
      await loadPage();
    } catch (requestError) {
      if (expirySubmissionRef.current === activeAttempt.id) {
        expirySubmissionRef.current = null;
        try {
          const { data } = await assessmentsAPI.getAttempt(activeAttempt.id);
          if (data.data.submittedAt) {
            const examResultsHeld = data.data.assessment.type === 'EXAMINATION'
              && !data.data.assessment.resultsReleased
              && !data.data.resultsReleasedAt;
            setNotice(examResultsHeld
              ? 'Time expired. Your examination was submitted; results will be available after an administrator releases them.'
              : `Time expired. Your saved answers were submitted${data.data.score === null ? '.' : ` with a score of ${data.data.score}/${data.data.maxScore}.`}`);
            setActiveAssessment(null);
            setActiveAttempt(null);
            setReviewBeforeSubmit(false);
            await loadPage();
            return;
          }
        } catch (refreshError) {
          setError(refreshError.response?.data?.message || requestError.response?.data?.message || 'Could not confirm the expired assessment submission.');
          return;
        }
      }
      setError(requestError.response?.data?.message || 'Could not submit this assessment.');
    } finally {
      setSaving(false);
    }
  };

  const reviewAttempt = async (attempt) => {
    setError('');
    try {
      const { data } = await assessmentsAPI.getAttempt(attempt.id);
      setAttemptReview(data.data);
      setGradeDraft(Object.fromEntries(data.data.answers.map((answer) => [answer.questionId, answer.points ?? 0])));
      setFeedbackDraft(Object.fromEntries(data.data.answers.map((answer) => [answer.questionId, answer.feedback || ''])));
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not open this assessment attempt.');
    }
  };

  const submitGrades = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const answers = attemptReview.assessment.questions
        .filter((question) => question.type === 'SHORT_ANSWER' && attemptReview.answers.some((answer) => answer.questionId === question.id))
        .map((question) => ({
          questionId: question.id,
          points: Number(gradeDraft[question.id] || 0),
          feedback: feedbackDraft[question.id] || '',
        }));
      if (!answers.length) {
        setError('There are no short-answer responses to grade.');
        return;
      }
      await assessmentsAPI.gradeAttempt(attemptReview.id, { answers });
      setNotice('Short-answer responses graded.');
      setAttemptReview(null);
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save assessment grades.');
    } finally {
      setSaving(false);
    }
  };

  const updateMultiAnswer = (questionId, choice, checked) => {
    const selected = Array.isArray(quizAnswers[questionId]) ? quizAnswers[questionId] : [];
    const answer = checked ? [...selected, choice] : selected.filter((item) => item !== choice);
    setQuizAnswers((current) => ({ ...current, [questionId]: answer }));
    persistAnswer(questionId, answer);
  };

  const reviewStudentAttempt = async (attempt) => {
    setError('');
    try {
      const { data } = await assessmentsAPI.getAttempt(attempt.id);
      setStudentAttemptReview(data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not open your assessment results.');
    }
  };

  useEffect(() => {
    if (!activeAttempt || !activeAssessment?.timeLimitMin
      || getRemainingSeconds(activeAttempt, activeAssessment.timeLimitMin, clockNow) !== 0) return;
    if (expirySubmissionRef.current === activeAttempt.id) return;
    expirySubmissionRef.current = activeAttempt.id;
    submitAttempt();
  }, [activeAttempt, activeAssessment, clockNow]);

  const courseTitle = (courseId) => courses.find((course) => course.id === courseId)?.title || 'Course';
  const selectedCourse = courses.find((course) => course.id === form.courseId);
  const offeringOptions = [...new Map(cohorts
    .filter((cohort) => cohort.programmeId === selectedCourse?.programmeId && cohort.intakeProgramOffering?.intake)
    .map((cohort) => {
      const { id, intake } = cohort.intakeProgramOffering;
      return [id, {
        value: id,
        label: `GATE ${String(intake.gateNumber).padStart(2, '0')} — ${intake.season} ${intake.year}`,
      }];
    })).values()];
  const remainingSeconds = activeAttempt && activeAssessment
    ? getRemainingSeconds(activeAttempt, activeAssessment.timeLimitMin, clockNow)
    : null;
  const timeExpired = remainingSeconds === 0;
  const activeAvailability = activeAssessment
    ? getAssessmentAvailability(activeAssessment, new Date(clockNow))
    : null;
  const canEditAttempt = Boolean(activeAvailability?.available && !timeExpired);
  const currentQuestion = activeAssessment?.questions[currentQuestionIndex];
  const isQuestionAnswered = (questionId) => {
    const answer = quizAnswers[questionId];
    return Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== null && String(answer).trim() !== '';
  };

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">{canManage ? 'Measure learning' : 'Your learning'}</span>
          <h1>{canManage ? 'Assessments and examinations' : 'Your assessments and examinations'}</h1>
          <p>{canManage ? 'Create learning checks or examinations, then review learner results.' : 'Take your available assessments and examinations and review released results.'}</p>
        </div>
        {canManage && <Button onClick={() => setShowForm((open) => !open)}><Plus size={16} /> {showForm ? 'Close form' : 'Create assessment'}</Button>}
      </section>

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {showForm && canManage && <section className="card assessment-create-card">
        <div className="card-heading"><div><span className="eyebrow">Assessment setup</span><h2>New assessment or examination</h2></div></div>
        <form className="assessment-form" onSubmit={handleCreateAssessment}>
          <Input label="Assessment title" value={form.title} onChange={(title) => setForm((current) => ({ ...current, title }))} required />
          <Textarea label="Description" value={form.description} onChange={(description) => setForm((current) => ({ ...current, description }))} />
          <Textarea label="Instructions" value={form.instructions} onChange={(instructions) => setForm((current) => ({ ...current, instructions }))} />
          <div className="assessment-form-grid">
            <Select label="Course" value={form.courseId} onChange={(courseId) => setForm((current) => ({ ...current, courseId, programOfferingId: '' }))} options={courses.map((course) => ({ value: course.id, label: course.title }))} required />
            <Select
              label="Intake scope"
              value={form.programOfferingId}
              onChange={(programOfferingId) => setForm((current) => ({ ...current, programOfferingId }))}
              options={[
                { value: '', label: offeringOptions.length ? 'Select an Intake' : 'Shared course activity' },
                ...offeringOptions,
              ]}
              required={offeringOptions.length > 0}
            />
            <Select label="Type" value={form.type} onChange={(type) => setForm((current) => ({ ...current, type }))} options={[{ value: 'ASSESSMENT', label: 'Assessment — score shown immediately' }, { value: 'EXAMINATION', label: 'Examination — result held for admin release' }]} required />
            <Input label="Time limit (minutes)" type="number" min="1" value={form.timeLimitMin} onChange={(timeLimitMin) => setForm((current) => ({ ...current, timeLimitMin }))} />
            <Input label="Attempt limit" type="number" min="1" value={form.attemptLimit} onChange={(attemptLimit) => setForm((current) => ({ ...current, attemptLimit }))} required />
            <Input label="Pass mark (%)" type="number" min="0" max="100" value={form.passMarkPercent} onChange={(passMarkPercent) => setForm((current) => ({ ...current, passMarkPercent }))} required />
            <Input label="Available from" type="datetime-local" value={form.availableFrom} onChange={(availableFrom) => setForm((current) => ({ ...current, availableFrom }))} />
            <Input label="Available until" type="datetime-local" value={form.availableTo} onChange={(availableTo) => setForm((current) => ({ ...current, availableTo }))} />
          </div>
          <div className="lesson-form-actions"><Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create assessment'}</Button><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button></div>
        </form>
      </section>}

      {activeAssessment && activeAttempt && <section className="card quiz-panel">
        <div className="card-heading">
          <div><span className="eyebrow">{activeAssessment.type === 'EXAMINATION' ? 'Examination in progress' : 'Assessment in progress'}</span><h2>{activeAssessment.title}</h2><p>{activeAssessment.description}</p></div>
          <span className={`quiz-timer${timeExpired ? ' status-danger' : ''}`}><Clock3 size={15} />{remainingSeconds === null ? 'No time limit' : timeExpired ? 'Time limit elapsed' : formatRemainingTime(remainingSeconds)}</span>
        </div>
        {timeExpired && <div className="notice notice-warning">Your time has elapsed. You can submit the answers saved before the deadline.</div>}
        {!activeAvailability?.available && <div className="notice notice-warning">This assessment is outside its availability window. Review and submit answers already saved; changes are locked.</div>}
        {!reviewBeforeSubmit && currentQuestion ? <>
          <nav className="quiz-question-nav" aria-label="Assessment questions">
            {activeAssessment.questions.map((question, index) => (
              <Button key={question.id} size="sm" variant={index === currentQuestionIndex ? 'primary' : isQuestionAnswered(question.id) ? 'secondary' : 'ghost'} aria-current={index === currentQuestionIndex ? 'step' : undefined} onClick={() => setCurrentQuestionIndex(index)}>
                {index + 1}
              </Button>
            ))}
          </nav>
          <article className="quiz-question" key={currentQuestion.id}>
            <div className="quiz-question-heading"><span>Question {currentQuestionIndex + 1}</span><small>{currentQuestion.points} point{currentQuestion.points === 1 ? '' : 's'}</small></div>
            <h3>{currentQuestion.prompt}</h3>
            {currentQuestion.type === 'SHORT_ANSWER' ? <Textarea label="Your answer" value={quizAnswers[currentQuestion.id] || ''} disabled={!canEditAttempt} onChange={(answer) => setAnswer(currentQuestion.id, answer)} onBlur={(event) => persistAnswer(currentQuestion.id, event.currentTarget.value)} /> :
              currentQuestion.type === 'MULTIPLE_ANSWER' ? <div className="quiz-options">{(currentQuestion.options || []).map((option) => (
                <label className="quiz-option" key={option}><input type="checkbox" disabled={!canEditAttempt} checked={(quizAnswers[currentQuestion.id] || []).includes(option)} onChange={(event) => updateMultiAnswer(currentQuestion.id, option, event.target.checked)} />{option}</label>
              ))}</div> :
                <div className="quiz-options">{(currentQuestion.options || (currentQuestion.type === 'TRUE_FALSE' ? ['True', 'False'] : [])).map((option) => (
                  <label className={`quiz-option${quizAnswers[currentQuestion.id] === option ? ' selected' : ''}`} key={option}><input type="radio" name={currentQuestion.id} disabled={!canEditAttempt} checked={quizAnswers[currentQuestion.id] === option} onChange={() => { setAnswer(currentQuestion.id, option); persistAnswer(currentQuestion.id, option); }} />{option}</label>
                ))}</div>}
          </article>
          <div className="lesson-form-actions">
            <Button variant="ghost" disabled={currentQuestionIndex === 0} onClick={() => setCurrentQuestionIndex((index) => index - 1)}>Previous question</Button>
            <Button variant="ghost" disabled={currentQuestionIndex >= activeAssessment.questions.length - 1} onClick={() => setCurrentQuestionIndex((index) => index + 1)}>Next question</Button>
          </div>
        </> : !reviewBeforeSubmit && <div className="notice notice-warning">This assessment has no questions yet. Contact your trainer before starting it.</div>}
        {reviewBeforeSubmit && <div className="card assessment-answer-review">
          <h3>Review your answers</h3>
          <p>{activeAssessment.questions.filter((question) => isQuestionAnswered(question.id)).length} of {activeAssessment.questions.length} questions answered. Unanswered questions will receive no points.</p>
          {activeAssessment.questions.map((question, index) => <div className="question-summary" key={question.id}>
            <span className="question-count">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{question.prompt}</strong><small>{isQuestionAnswered(question.id) ? 'Answered' : 'Unanswered'}</small></span>
          </div>)}
        </div>}
        <div className="lesson-form-actions">
          {reviewBeforeSubmit
            ? <><Button disabled={saving} variant="secondary" onClick={() => setReviewBeforeSubmit(false)}>Back to answers</Button><Button disabled={saving || !activeAssessment.questions.length} onClick={submitAttempt}>{saving ? 'Submitting…' : 'Confirm and submit'}</Button></>
            : <Button disabled={saving || !activeAssessment.questions.length} onClick={() => setReviewBeforeSubmit(true)}>Review before submitting</Button>}
          <Button variant="ghost" disabled={saving} onClick={leaveAttempt}>Leave assessment</Button>
        </div>
      </section>}

      {editingAssessment && canManage && <section className="card assessment-editor">
        <div className="card-heading">
          <div><span className="eyebrow">Question builder</span><h2>{editingAssessment.title}</h2><p>Add questions, then publish the assessment for students.</p></div>
          <Button variant="ghost" onClick={() => setEditingAssessment(null)}>Close</Button>
        </div>
        <form className="question-form" onSubmit={saveQuestion}>
          <Input label="Question prompt" value={questionForm.prompt} onChange={(prompt) => setQuestionForm((current) => ({ ...current, prompt }))} required />
          <div className="assessment-form-grid">
            <Select label="Question type" value={questionForm.type} onChange={(type) => setQuestionForm((current) => ({ ...current, type }))} options={questionTypes} />
            <Input label="Points" type="number" min="1" value={questionForm.points} onChange={(points) => setQuestionForm((current) => ({ ...current, points }))} required />
          </div>
          {questionForm.type !== 'SHORT_ANSWER' && questionForm.type !== 'TRUE_FALSE' && <Textarea label="Options (one per line)" value={questionForm.options} onChange={(options) => setQuestionForm((current) => ({ ...current, options }))} required />}
          {questionForm.type !== 'SHORT_ANSWER' && <Input label={questionForm.type === 'MULTIPLE_ANSWER' ? 'Correct answers (comma separated)' : 'Correct answer'} value={questionForm.correctAnswer} onChange={(correctAnswer) => setQuestionForm((current) => ({ ...current, correctAnswer }))} required />}
          {questionForm.type === 'TRUE_FALSE' && <Select label="Correct answer" value={questionForm.correctAnswer} onChange={(correctAnswer) => setQuestionForm((current) => ({ ...current, correctAnswer }))} options={[{ value: 'True', label: 'True' }, { value: 'False', label: 'False' }]} required />}
          <Button type="submit" disabled={saving}><Plus size={15} /> Add question</Button>
        </form>
        <div className="question-list">
          {editingAssessment.questions.map((question, index) => <div className="question-summary" key={question.id}>
            <span className="question-count">{String(index + 1).padStart(2, '0')}</span>
            <span><strong>{question.prompt}</strong><small>{questionTypes.find((type) => type.value === question.type)?.label} · {question.points} point{question.points === 1 ? '' : 's'}</small></span>
            <button className="icon-button action-danger" onClick={() => deleteQuestion(question)} aria-label="Delete question"><Trash2 size={16} /></button>
          </div>)}
          {!editingAssessment.questions.length && <div className="empty-state"><h3>No questions yet</h3><p>Add at least one question before publishing.</p></div>}
        </div>
        <div className="assessment-publish-actions">
          {editingAssessment.status !== 'PUBLISHED'
            ? <Button disabled={!editingAssessment.questions.length} onClick={() => changeAssessmentStatus(editingAssessment, 'PUBLISHED')}><Check size={15} /> Publish assessment</Button>
            : <Button variant="secondary" onClick={() => changeAssessmentStatus(editingAssessment, 'CLOSED')}>
              Close {editingAssessment.type === 'EXAMINATION' ? 'examination' : 'assessment'}
            </Button>}
        </div>
      </section>}

      {attemptReview && canManage && <section className="card attempt-review">
        <div className="card-heading"><div><span className="eyebrow">Tutor review</span><h2>{attemptReview.student?.firstName} {attemptReview.student?.lastName} · {attemptReview.assessment.title}</h2></div><Button variant="ghost" onClick={() => setAttemptReview(null)}>Close</Button></div>
        {attemptReview.assessment.questions.map((question, index) => {
          const answer = attemptReview.answers.find((item) => item.questionId === question.id);
          return <div className="review-question" key={question.id}>
            <div><strong>{index + 1}. {question.prompt}</strong><p>{answer?.answer ?? 'No answer submitted'}</p></div>
            {question.type === 'SHORT_ANSWER' && answer && <Input label={`Score (max ${question.points})`} type="number" min="0" max={question.points} value={gradeDraft[question.id] ?? 0} onChange={(points) => setGradeDraft((current) => ({ ...current, [question.id]: points }))} />}
            {question.type === 'SHORT_ANSWER' && answer && <Textarea label="Feedback for learner" maxLength={2000} value={feedbackDraft[question.id] ?? ''} onChange={(feedback) => setFeedbackDraft((current) => ({ ...current, [question.id]: feedback }))} />}
            {question.type !== 'SHORT_ANSWER' && <span className="badge">{answer?.points ?? 0} / {question.points}</span>}
          </div>;
        })}
        <form onSubmit={submitGrades}><Button type="submit" disabled={saving}><Check size={15} /> Save short-answer grades</Button></form>
      </section>}

      {studentAttemptReview && !canManage && <section className="card attempt-review">
        <div className="card-heading">
          <div>
            <span className="eyebrow">{studentAttemptReview.assessment.type === 'EXAMINATION' ? 'Examination results' : 'Assessment results'}</span>
            <h2>{studentAttemptReview.assessment.title}</h2>
            {studentAttemptReview.assessment.type === 'EXAMINATION'
              && !studentAttemptReview.assessment.resultsReleased
              && !studentAttemptReview.resultsReleasedAt
              ? <p>Your examination was submitted. Results will be available after an administrator releases them.</p>
              : studentAttemptReview.status === 'GRADED'
              ? <p>Final score: {studentAttemptReview.score}/{studentAttemptReview.maxScore} · {studentAttemptReview.passed ? 'Passed' : 'Below the pass mark'}</p>
              : <p>{studentAttemptReview.score ?? 0} points earned so far. Your final result is pending trainer review.</p>}
          </div>
          <Button variant="ghost" onClick={() => setStudentAttemptReview(null)}>Close</Button>
        </div>
        {studentAttemptReview.assessment.questions.map((question, index) => {
          const answer = studentAttemptReview.answers.find((item) => item.questionId === question.id);
          const hasScore = answer?.points !== null && answer?.points !== undefined;
          return <div className="review-question student-result-question" key={question.id}>
            <div>
              <strong>{index + 1}. {question.prompt}</strong>
              <p>{answer?.answer ?? 'No answer submitted'}</p>
              {answer?.feedback && <p className="assessment-feedback">{answer.feedback}</p>}
            </div>
            {hasScore
              ? <span className={`badge ${answer.isCorrect ? 'badge-active' : 'badge-pending'}`}>{answer.points}/{question.points} points · {answer.isCorrect ? 'Correct' : 'Review'}</span>
              : answer
                ? <span className="badge badge-pending">Awaiting trainer feedback</span>
                : <span className="badge badge-draft">No response</span>}
          </div>;
        })}
      </section>}

      <section className="assessment-grid">
        {loading ? <div className="card loading-card">Loading assessments…</div> : assessments.length ? assessments.map((assessment) => {
          const course = courses.find((item) => item.id === assessment.courseId);
          const inProgressAttempt = !canManage && attempts.find((attempt) => attempt.assessmentId === assessment.id && attempt.status === 'IN_PROGRESS');
          const myAttempt = !canManage && attempts.find((attempt) => attempt.assessmentId === assessment.id && attempt.status !== 'IN_PROGRESS');
          const availability = getAssessmentAvailability(assessment);
          return <article className="assessment-card" key={assessment.id}>
            <div className="assessment-card-top"><span className="assessment-icon"><ClipboardCheck size={20} /></span><span className={statusClass(assessment.status)}>{statusLabel(assessment.status)}</span></div>
            <span className="eyebrow">{course?.title || courseTitle(assessment.courseId)}</span>
            {assessment.programOffering && <span className="eyebrow">{`GATE ${String(assessment.programOffering.intake.gateNumber).padStart(2, '0')} — ${assessment.programOffering.intake.season} ${assessment.programOffering.intake.year}`}</span>}
            <span className="eyebrow">{assessment.type === 'EXAMINATION' ? 'Examination' : 'Assessment'}</span>
            <h2>{assessment.title}</h2>
            <p>{assessment.description || 'Check your understanding and put your learning into practice.'}</p>
            <div className="assessment-meta"><span><Clock3 size={14} />{assessment.timeLimitMin ? `${assessment.timeLimitMin} minutes` : 'Flexible timing'}</span><span>{assessment.attemptLimit} attempt{assessment.attemptLimit === 1 ? '' : 's'}</span></div>
            {canManage ? <div className="assessment-actions">
              <Button variant="secondary" size="sm" onClick={() => openAssessmentEditor(assessment)}>Questions</Button>
              {assessment.type === 'EXAMINATION' && isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!assessment.resultsReleased && assessment.status !== 'CLOSED'}
                  onClick={() => changeResultsVisibility(assessment, !assessment.resultsReleased)}
                >
                  {assessment.resultsReleased ? 'Hide results' : assessment.status === 'CLOSED' ? 'Release results' : 'Close to release'}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => deleteAssessment(assessment)} aria-label="Delete assessment"><Trash2 size={15} /></Button>
            </div> : <div className="assessment-actions">
              {inProgressAttempt ? availability.available
                ? <Button size="sm" onClick={() => beginAttempt(assessment, inProgressAttempt)}>Resume assessment <ArrowUpRight size={15} /></Button>
                : <div className="assessment-result"><span className="badge badge-pending">{availability.message}</span><Button size="sm" variant="ghost" onClick={() => beginAttempt(assessment, inProgressAttempt)}>Review saved answers</Button></div> :
                myAttempt ? <div className="assessment-result">
                  <span>{myAttempt.assessment?.type === 'EXAMINATION'
                    && !myAttempt.assessment.resultsReleased
                    && !myAttempt.resultsReleasedAt
                    ? 'Examination submitted · result pending release'
                    : myAttempt.status === 'GRADED'
                      ? <>Final score <strong>{myAttempt.score ?? '—'}/{myAttempt.maxScore ?? '—'}</strong> · {myAttempt.passed ? 'Passed' : 'Below pass mark'}</>
                      : 'Awaiting Tutor feedback'}</span>
                  {!(myAttempt.assessment?.type === 'EXAMINATION'
                    && !myAttempt.assessment.resultsReleased
                    && !myAttempt.resultsReleasedAt)
                    && <Button size="sm" variant="ghost" onClick={() => reviewStudentAttempt(myAttempt)}>View results</Button>}
                </div> :
                  availability.available
                    ? <Button size="sm" onClick={() => beginAttempt(assessment)}>Start assessment <ArrowUpRight size={15} /></Button>
                    : <span className="badge badge-pending">{availability.message}</span>}
            </div>}
          </article>;
        }) : !loading && <div className="card empty-state"><ClipboardCheck size={25} /><h3>No assessments available</h3><p>{canManage ? 'Create an assessment to check learner understanding.' : 'Published course assessments will appear here.'}</p></div>}
      </section>

      {canManage && <section className="card attempts-panel">
        <div className="card-heading"><div><span className="eyebrow">Learner results</span><h2>Recent attempts</h2></div><span className="muted small">{attempts.length} attempts</span></div>
        {attempts.length ? <div className="attempt-list">{attempts.map((attempt) => (
          <div className="attempt-row" key={attempt.id}>
            <span className="person-avatar">{`${attempt.student?.firstName?.[0] || ''}${attempt.student?.lastName?.[0] || ''}`.toUpperCase()}</span>
            <span><strong>{attempt.student?.firstName} {attempt.student?.lastName}</strong><small>{attempt.assessment?.type === 'EXAMINATION' ? 'Examination' : 'Assessment'} · {attempt.assessment?.title} · {new Date(attempt.startedAt).toLocaleDateString()}</small></span>
            <span className="attempt-score">{attempt.score ?? '—'} / {attempt.maxScore ?? '—'}</span>
            <span className={statusClass(attempt.status)}>{statusLabel(attempt.status)}</span>
            {isAdmin
              && attempt.assessment?.type === 'EXAMINATION'
              && attempt.submittedAt
              && attempt.status === 'GRADED'
              && !attempt.assessment.resultsReleased
              && !attempt.resultsReleasedAt
              && <Button
                variant="ghost"
                size="sm"
                disabled={releasingAttemptId === attempt.id}
                onClick={() => releaseAttemptResult(attempt)}
              >
                {releasingAttemptId === attempt.id ? 'Releasing…' : 'Release result'}
              </Button>}
            {attempt.submittedAt && <Button variant="ghost" size="sm" onClick={() => reviewAttempt(attempt)}>Review <ArrowUpRight size={14} /></Button>}
          </div>
        ))}</div> : <div className="empty-state"><h3>No attempts submitted</h3><p>Student assessment results will appear here.</p></div>}
      </section>}
    </div>
  );
}
