import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.DEV ? '/api' : (import.meta.env.VITE_API_BASE_URL || '/api'),
  withCredentials: true,  // Send HTTP-only cookies with every request
});

// Request interceptor to add auth token if available
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },  (error) => Promise.reject(error)
);

// Response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Store the original URL to redirect after login
      localStorage.setItem('redirectUrl', error.config?.url || '/');
      // Clear auth token
      localStorage.removeItem('token');
      // Return rejected promise - auth context will handle redirect
      return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

export default api;

const uploadWithStorageIntent = async ({
  intentPath,
  finalizePath,
  file,
  metadata,
  localForm,
}) => {
  const { data } = await api.post(intentPath, {
    originalName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    ...metadata,
  });
  const intent = data.data;
  if (intent.mode === 'local') return api.post(finalizePath, localForm);

  const uploadResponse = await fetch(intent.uploadUrl, {
    method: 'PUT',
    headers: intent.headers,
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`Object storage upload failed with status ${uploadResponse.status}`);
  }
  return api.post(finalizePath, {
    originalName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    storageKey: intent.storageKey,
    ...metadata,
  });
};

// Keep proxied files below Vercel's request-body limit; larger files use signed storage uploads.
const objectStorageProxyLimitBytes = 4 * 1024 * 1024;

// Auth API methods
export const authAPI = {
  // Get current user - called on mount, not repeatedly
  // This should be called once during app initialization
  getCurrentUser: async () => {
    try {
      const res = await api.get('/auth/me');
      return res.data;
    } catch (error) {
      // 401 means user is not authenticated
      localStorage.removeItem('token');
      return null;
    }
  },

  // Me - alias for getCurrentUser, used by useAuth hook
  me: async () => {
    try {
      const res = await api.get('/auth/me');
      return res.data;
    } catch (error) {
      // 401 means user is not authenticated
      localStorage.removeItem('token');
      return null;
    }
  },

  // Login - sends credentials, sets session cookies
  login: async (credentials) => {
    const res = await api.post('/auth/login', credentials);
    if (res.data.token) {
      localStorage.setItem('token', res.data.token);
    }
    return res.data;
  },

  // Logout - clears session cookies
  logout: async () => {
    await api.post('/auth/logout');
    localStorage.removeItem('token');
    localStorage.removeItem('redirectUrl');
  },

  // Register - creates new account
  register: async (userData) => {
    const res = await api.post('/auth/register', userData);
    return res.data;
  },
  forgotPassword: async (data) => api.post('/auth/forgot-password', data),
  resetPassword: async (data) => api.post('/auth/reset-password', data),
  acceptInvitation: async (data) => api.post('/auth/accept-invitation', data),
  approveUser: async (data) => api.post('/auth/users/approve', data),
  createInvitation: async (data) => api.post('/auth/invitations', data),
};

export const applicationsAPI = {
  offerings: async () => api.get('/applications/offerings'),
  mine: async () => api.get('/applications/me'),
  submit: async (data) => api.post('/applications', data),
  list: async (params = {}) => api.get('/applications/admin', { params }),
  get: async (id) => api.get(`/applications/admin/${id}`),
  approve: async (id, data = {}) => api.post(`/applications/admin/${id}/approve`, data),
  reject: async (id, data) => api.post(`/applications/admin/${id}/reject`, data),
};

export const programEnrollmentsAPI = {
  unassignedStudents: async (params = {}) => api.get('/program-enrollments/unassigned-students', { params }),
  assignUnassignedStudent: async (studentId, data) =>
    api.post(`/program-enrollments/unassigned-students/${studentId}/assign`, data),
  assignableOfferings: async () => api.get('/program-enrollments/offerings'),
  assignmentHistory: async (params = {}) => api.get('/program-enrollments/assignment-history', { params }),
};

// Dashboard API methods
export const dashboardAPI = {
  admin: async () => api.get('/dashboard/admin'),
  trainer: async () => api.get('/dashboard/trainer'),
  student: async () => api.get('/dashboard/student'),
};

// Notifications API methods
export const notificationsAPI = {
  listNotifications: async (params = {}) => api.get('/notifications/', { params }),
  unreadCount: async () => api.get('/notifications/unread-count'),
  markRead: async (id) => api.put(`/notifications/${id}/read`),
  markAllRead: async () => api.put('/notifications/read-all'),
  listForReview: async (params = {}) => api.get('/notifications/admin/review', { params }),
  classificationOptions: async () => api.get('/notifications/admin/review/options'),
  classify: async (id, data) => api.post(`/notifications/admin/${id}/classification`, data),
  listAnnouncements: async (params = {}) => api.get('/notifications/announcements', { params }),
  createAnnouncement: async (data) =>
    api.post('/notifications/announcements', data),
  recordAttendance: async (data) =>
    api.post('/notifications/attendance', data),
  listAttendanceCohorts: async () => api.get('/notifications/attendance/cohorts'),
  listAttendance: async (params = {}) => api.get('/notifications/attendance', { params }),
};

// Assessments API methods
export const assessmentsAPI = {
  list: async () => api.get('/assessments/'),
  get: async (id) => api.get(`/assessments/${id}`),
  create: async (form) => api.post('/assessments/', form),
  update: async (id, form) => api.put(`/assessments/${id}`, form),
  delete: async (id) => api.delete(`/assessments/${id}`),
  addQuestion: async (id, form) => api.post(`/assessments/${id}/questions`, form),
  updateQuestion: async (id, form) => api.put(`/assessments/questions/${id}`, form),
  deleteQuestion: async (id) => api.delete(`/assessments/questions/${id}`),
  startAttempt: async (id) => api.post(`/assessments/${id}/attempts`),
  saveAnswer: async (form) => api.post('/assessments/answers', form),
  submitAttempt: async (id) => api.post(`/assessments/attempts/${id}/submit`),
  listAttempts: async (filters) => api.get('/assessments/attempts', { params: filters }),
  getAttempt: async (id) => api.get(`/assessments/attempts/${id}`),
  gradeAttempt: async (id, form) => api.post(`/assessments/attempts/${id}/grade`, form),
  releaseAttemptResults: async (id) => api.post(`/assessments/attempts/${id}/release-results`),
};

// Courses API methods
export const coursesAPI = {
  list: async () => api.get('/courses/'),
  get: async (id) => api.get(`/courses/${id}`),
  builder: async (id) => api.get(`/courses/${id}/preview`),
  quality: async (id) => api.get(`/courses/${id}/quality`),
  publish: async (id) => api.post(`/courses/${id}/publish`),
  unpublish: async (id) => api.post(`/courses/${id}/unpublish`),
  archive: async (id) => api.post(`/courses/${id}/archive`),
  create: async (form) => api.post('/courses/', form),
  update: async (id, form) => api.put(`/courses/${id}`, form),
  delete: async (id) => api.delete(`/courses/${id}`),
  reorderModules: async (id, moduleIds) => api.put(`/courses/${id}/modules/order`, { moduleIds }),
  reorderLessons: async (moduleId, lessonIds) => api.put(`/courses/modules/${moduleId}/lessons/order`, { lessonIds }),
  createModule: async (courseId, form) => api.post(`/courses/${courseId}/modules`, form),
  updateModule: async (id, form) => api.put(`/courses/modules/${id}`, form),
  deleteModule: async (id) => api.delete(`/courses/modules/${id}`),
  createLesson: async (moduleId, form) => api.post(`/courses/modules/${moduleId}/lessons`, form),
  updateLesson: async (id, form) => api.put(`/courses/lessons/${id}`, form),
  deleteLesson: async (id) => api.delete(`/courses/lessons/${id}`),
  getLesson: async (id) => api.get(`/courses/lessons/${id}`),
  listAssignments: async (filters) => api.get('/courses/assignments', { params: filters }),
  getAssignment: async (id) => api.get(`/courses/assignments/${id}`),
  createAssignment: async (courseId, form) => api.post(`/courses/${courseId}/assignments`, form),
  submitAssignment: async (id, form) => api.post(`/courses/assignments/${id}/submit`, form),
  gradeSubmission: async (id, form) => api.post(`/courses/submissions/${id}/grade`, form),
  releaseSubmissionGrade: async (id) => api.post(`/courses/submissions/${id}/release`),
};

export const courseDiscussionsAPI = {
  list: async (courseId, params = {}) =>
    api.get(`/course-discussions/courses/${courseId}/discussions`, { params }),
  create: async (courseId, data) =>
    api.post(`/course-discussions/courses/${courseId}/discussions`, data),
  replies: async (postId, params = {}) =>
    api.get(`/course-discussions/posts/${postId}/replies`, { params }),
  reply: async (postId, data) =>
    api.post(`/course-discussions/posts/${postId}/replies`, data),
  updatePost: async (postId, data) =>
    api.patch(`/course-discussions/posts/${postId}`, data),
  removePost: async (postId, data = {}) =>
    api.delete(`/course-discussions/posts/${postId}`, { data }),
  report: async (postId, data) =>
    api.post(`/course-discussions/posts/${postId}/report`, data),
  moderate: async (postId, data) =>
    api.post(`/course-discussions/posts/${postId}/moderate`, data),
  reports: async (params = {}) => api.get('/course-discussions/moderation/reports', { params }),
  reviewReport: async (reportId, data) =>
    api.patch(`/course-discussions/moderation/reports/${reportId}`, data),
  moderationHistory: async (params = {}) =>
    api.get('/course-discussions/moderation/history', { params }),
};

export const progressAPI = {
  mine: async () => api.get('/progress/me'),
  accessLesson: async (lessonId) => api.post('/progress/access', { lessonId }),
  completeLesson: async (lessonId) => api.post('/progress/complete', { lessonId }),
};

export const liveClassesAPI = {
  list: async () => api.get('/live-classes'),
  create: async (form) => api.post('/live-classes', form),
  createEmergency: async (form) => api.post('/live-classes/emergency', form),
  reschedule: async (id, form) => api.patch(`/live-classes/${id}/schedule`, form),
  cancel: async (id) => api.post(`/live-classes/${id}/cancel`),
  delete: async (id) => api.delete(`/live-classes/${id}`),
  exportCalendar: async (id) => api.get(`/live-classes/${id}/export.ics`, { responseType: 'blob' }),
  start: async (id) => api.post(`/live-classes/${id}/start`),
  join: async (id) => api.post(`/live-classes/${id}/join`),
  leave: async (id) => api.post(`/live-classes/${id}/leave`),
  end: async (id) => api.post(`/live-classes/${id}/end`),
  startRecording: async (id, consentConfirmed) => api.post(`/live-classes/${id}/recordings`, { consentConfirmed }),
  listRecordings: async (id) => api.get(`/live-classes/${id}/recordings`),
  stopRecording: async (id, recordingId) => api.post(`/live-classes/${id}/recordings/${recordingId}/stop`),
  recordingPlayback: async (recordingId, download = false) => api.get(
    `/live-classes/recordings/${recordingId}/playback`,
    { params: download ? { download: true } : undefined },
  ),
  report: async (id, params = {}) => api.get(`/live-classes/${id}/report`, { params }),
  verifyPresence: async (id, presenceId, note) => api.post(`/live-classes/${id}/presences/${presenceId}/verify`, { note }),
  correctPresence: async (id, presenceId, form) => api.patch(`/live-classes/${id}/presences/${presenceId}`, form),
};

export const resourcesAPI = {
  list: async (params = {}) => api.get('/resources/', { params }),
  upload: async (formData) => {
    const file = formData.get('file');
    if (!file || typeof file.name !== 'string' || typeof file.size !== 'number') {
      throw new Error('Choose a file to upload');
    }
    if (file.size <= objectStorageProxyLimitBytes) return api.post('/resources/', formData);
    return uploadWithStorageIntent({
      intentPath: '/resources/upload-intent',
      finalizePath: '/resources/',
      file,
      localForm: formData,
      metadata: {
        courseId: formData.get('courseId'),
        lessonId: formData.get('lessonId') || undefined,
      },
    });
  },
  update: async (id, form) => api.put(`/resources/${id}`, form),
  downloadUrl: (id) => `${api.defaults.baseURL}/resources/${id}/download`,
  delete: async (id) => api.delete(`/resources/${id}`),
};

// Programmes API methods
export const programmesAPI = {
  list: async () => api.get('/programmes/'),
  create: async (form) => api.post('/programmes/', form),
  update: async (id, form) => api.put(`/programmes/${id}`, form),
  delete: async (id) => api.delete(`/programmes/${id}`),
};

export const intakesAPI = {
  list: async () => api.get('/intakes/'),
  get: async (id) => api.get(`/intakes/${id}`),
  create: async (form) => api.post('/intakes/', form),
  update: async (id, form) => api.put(`/intakes/${id}`, form),
  addOfferings: async (id, offerings, status) =>
    api.post(`/intakes/${id}/offerings`, { offerings, status }),
  updateOffering: async (id, offeringId, updates) =>
    api.patch(`/intakes/${id}/offerings/${offeringId}`, updates),
  uploadTimetable: async (id, offeringId, file) => {
    const localForm = new FormData();
    localForm.append('file', file);
    if (file.size <= objectStorageProxyLimitBytes) {
      return api.post(`/intakes/${id}/offerings/${offeringId}/timetable`, localForm);
    }
    return uploadWithStorageIntent({
      intentPath: `/intakes/${id}/offerings/${offeringId}/timetable/upload-intent`,
      finalizePath: `/intakes/${id}/offerings/${offeringId}/timetable`,
      file,
      localForm,
    });
  },
  timetableDownloadUrl: (id, offeringId) =>
    `${api.defaults.baseURL}/intakes/${id}/offerings/${offeringId}/timetable`,
  removeOffering: async (id, offeringId) =>
    api.delete(`/intakes/${id}/offerings/${offeringId}`),
};

// Cohorts API methods
export const cohortsAPI = {
  list: async () => api.get('/cohorts/'),
  get: async (id) => api.get(`/cohorts/${id}`),
  create: async (form) => api.post('/cohorts/', form),
  update: async (id, form) => api.put(`/cohorts/${id}`, form),
  delete: async (id) => api.delete(`/cohorts/${id}`),
  enrolStudent: async (id, studentId) => api.post(`/cohorts/${id}/enrol`, { studentId }),
  removeEnrolment: async (id, enrolmentId) => api.delete(`/cohorts/${id}/enrolments/${enrolmentId}`),
  assignTrainer: async (id, trainerId) => api.post(`/cohorts/${id}/trainers`, { trainerId }),
  removeTrainer: async (id, assignmentId) => api.delete(`/cohorts/${id}/trainers/${assignmentId}`),
  assignCourse: async (id, courseId) => api.post(`/cohorts/${id}/courses`, { courseId }),
  removeCourse: async (id, assignmentId) => api.delete(`/cohorts/${id}/courses/${assignmentId}`),
};

// Users API methods
export const usersAPI = {
  list: async (filters) => api.get('/users/', { params: filters }),
  get: async (id) => api.get(`/users/${id}`),
  update: async (id, form) => api.put(`/users/${id}`, form),
  uploadAvatar: async (id, file) => {
    const localForm = new FormData();
    localForm.append('file', file);
    return api.post(`/users/${id}/avatar`, localForm);
  },
  changePassword: async (id, form) => api.post(`/users/${id}/password`, form),
  avatarImageUrl: (avatarUrl) => avatarUrl
    ? `${api.defaults.baseURL.replace(/\/$/, '')}${avatarUrl}`
    : '',
  delete: async (id) => api.delete(`/users/${id}`),
};