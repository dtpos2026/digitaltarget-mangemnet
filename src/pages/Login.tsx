import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

// Accounts are created by an admin from Settings → User Management; there is
// no public sign-up.
export default function Login() {
  const { login, resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    }
    setLoading(false);
  };

  const handleReset = async () => {
    setError("");
    setInfo("");
    if (!email.trim()) { setError("Pehle apna email likhein."); return; }
    try {
      await resetPassword(email.trim());
      setInfo("Password reset link aap ke email par bhej diya gaya hai.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">DT</div>
        <h1>Digital Target</h1>
        <p className="login-subtitle">Business Management System</p>

        {error && <div className="login-error">{error}</div>}
        {info && <div className="login-info">{info}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoComplete="username"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              minLength={6}
            />
          </div>
          <button type="submit" className="btnSolid login-btn" disabled={loading}>
            {loading ? "Please wait..." : "Login"}
          </button>
        </form>

        <button className="login-toggle" onClick={handleReset}>
          Password bhool gaye? Reset link bhejein
        </button>
      </div>
    </div>
  );
}
