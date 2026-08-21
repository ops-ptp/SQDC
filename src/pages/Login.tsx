import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEmployee } from '../context/EmployeeContext';

export default function Login() {
  const { loginWithCode } = useEmployee();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/entry';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginWithCode(code);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card login-card" onSubmit={handleSubmit}>
        <h1>Enter your Employee ID</h1>
        <p className="muted">This tells us which KPIs are yours to update today.</p>
        <input
          autoFocus
          className="input input-lg"
          placeholder="e.g. E001"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
          {submitting ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
