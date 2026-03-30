import { createContext, useContext, useEffect, useState } from 'react';
import { getMeApi, loginApi, logoutApi, registerApi } from '../api/authApi';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      try {
        const res = await getMeApi();
        setUser(res.data.user);
      } catch {
        setUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    loadUser();
  }, []);

  const login = async (credentials) => {
    const res = await loginApi(credentials);
    const token = res.data?.token;
    if (token) {
      window.localStorage.setItem('qs_token', token);
    }
    setUser(res.data.user);
    return res.data;
  };

  const register = async (payload) => {
    const res = await registerApi(payload);
    const token = res.data?.token;
    if (token) {
      window.localStorage.setItem('qs_token', token);
    }
    setUser(res.data.user);
    return res.data;
  };

  const logout = async () => {
    await logoutApi();
    window.localStorage.removeItem('qs_token');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        login,
        register,
        logout,
        authLoading,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}