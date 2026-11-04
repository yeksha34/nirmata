import { type FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { T } from "../i18n";
import { Brand } from "../ui";

const goHome = () => window.location.assign("/");

/** The page an invitation link opens: choose a password, say you are an adult, and you are in. */
export function AcceptInvite() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [email, setEmail] = useState<string>();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [adult, setAdult] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("That invitation is not valid.");
      return;
    }
    api
      .invitation(token)
      .then((r) => setEmail(r.email))
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (!registered) {
        await api.register(token, password);
        setRegistered(true);
      }
      await api.onboard({ attestAdult: adult, token });
      goHome();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mismatch = again.length > 0 && again !== password;
  return (
    <main className="join">
      <form className="join-card" onSubmit={submit}>
        <Brand />
        <h1>
          <T>Accept your invitation</T>
        </h1>
        {email && (
          <>
            <p className="muted">
              <T>This invitation is for the address below. Only a password is left to choose.</T>
            </p>
            <output className="email-chip">{email}</output>
          </>
        )}

        {email && (
          <>
            <label htmlFor="password">
              <T>Choose a password</T>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              // biome-ignore lint/a11y/noAutofocus: this is the only thing on the page
              autoFocus
              required
              disabled={registered}
            />
            <p className="hint">
              <T>At least 8 characters.</T>
            </p>
            <label htmlFor="again">
              <T>Password again</T>
            </label>
            <input
              id="again"
              type="password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              autoComplete="new-password"
              maxLength={200}
              required
              disabled={registered}
            />
            {mismatch && (
              <p className="error" role="alert">
                <T>The two passwords are different.</T>
              </p>
            )}
            <label className="check">
              <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
              <T>I am an adult (18 or older). This world is for adult readers.</T>
            </label>
          </>
        )}

        {error && (
          <p className="error" role="alert">
            <T>{error}</T>
          </p>
        )}
        {email && (
          <button
            type="submit"
            className="primary"
            disabled={busy || !adult || password.length < 8 || password !== again}
          >
            <T>{busy ? "Working…" : registered ? "Try again" : "Create account"}</T>
          </button>
        )}
      </form>
    </main>
  );
}

/** Email and password for someone who already has an account. */
export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.login(email.trim(), password);
      goHome();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="join">
      <form className="join-card" onSubmit={submit}>
        <Brand />
        <h1>
          <T>Sign in</T>
        </h1>
        <p className="muted">
          <T>Come back with your address and password.</T>
        </p>
        <label htmlFor="email">
          <T>Email</T>
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          maxLength={200}
          // biome-ignore lint/a11y/noAutofocus: this is the only thing on the page
          autoFocus
          required
        />
        <label htmlFor="password">
          <T>Password</T>
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          maxLength={200}
          required
        />
        {error && (
          <p className="error" role="alert">
            <T>{error}</T>
          </p>
        )}
        <button type="submit" className="primary" disabled={busy || !email.trim() || !password}>
          <T>{busy ? "Signing in…" : "Sign in"}</T>
        </button>
      </form>
    </main>
  );
}
