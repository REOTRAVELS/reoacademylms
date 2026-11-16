import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../services/api';
import { normalizeUser, normalizeUserResponse } from './normalizeUser.js';

export const AuthContext = createContext(null);

const canEnterWorkspace = (user) => (
  user?.status === 'ACTIVE'
  && (user.academicAccess !== false || user.intakeAccessState === 'WAITING')
);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const res = await authAPI.me();
      const currentUser = normalizeUserResponse(res);
      setUser(canEnterWorkspace(currentUser) ? currentUser : null);
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (credentials) => {
    const res = await authAPI.login(credentials);
    const authenticatedUser = normalizeUserResponse(res);
    setUser(canEnterWorkspace(authenticatedUser) ? authenticatedUser : null);
    return authenticatedUser;
  };

  const register = async (data) => {
    return await authAPI.register(data);
  };

  const acceptInvitation = async (data) => {
    const res = await authAPI.acceptInvitation(data);
    setUser(normalizeUser(res.data.data));
    return res.data;
  };

  const logout = async () => {
    try { await authAPI.logout(); } catch (e) {}
    setUser(null);
  };

  const value = { user, loading, login, register, acceptInvitation, logout, refreshUser: loadUser };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
