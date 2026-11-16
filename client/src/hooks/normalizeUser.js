export const normalizeUser = (user) => {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return null;

  return {
    ...user,
    role: typeof user.role === 'string' ? { name: user.role } : user.role,
  };
};

export const normalizeUserResponse = (response) => normalizeUser(response?.data);
