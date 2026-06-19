import React, { useState } from 'react';
import CustomerChat from './components/CustomerChat';
import AdminLogin from './components/AdminLogin';
import AdminShell from './components/AdminShell';
import './App.css';

/**
 * App routing:
 *   /         → CustomerChat  (public)
 *   /admin    → AdminLogin    (public login page)
 *   /admin/*  → AdminShell    (protected, requires token)
 *
 * We use a simple hash-based route since this is a single-page app
 * with no router library.
 */
export default function App() {
  const [adminToken, setAdminToken] = useState(
    sessionStorage.getItem('admin_token') || null
  );

  const path = window.location.pathname;
  const isAdminPath = path.startsWith('/admin');

  const handleLogin = (token) => {
    sessionStorage.setItem('admin_token', token);
    setAdminToken(token);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('admin_token');
    setAdminToken(null);
  };

  if (isAdminPath) {
    if (adminToken) {
      return <AdminShell token={adminToken} onLogout={handleLogout} />;
    }
    return <AdminLogin onLogin={handleLogin} />;
  }

  return <CustomerChat />;
}
