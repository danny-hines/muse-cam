import { redirect } from "next/navigation";

import { login } from "@/app/admin/actions";
import { adminAuthIsConfigured, isAdminAuthenticated } from "@/lib/admin-auth";

type LoginPageProps = { searchParams: Promise<{ error?: string }> };

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  if (await isAdminAuthenticated()) redirect("/admin");
  const { error } = await searchParams;
  const configured = adminAuthIsConfigured();

  return (
    <main className="admin-login">
      <section className="admin-login-card">
        <p className="section-kicker">Private controls</p>
        <h1>Muse Cam admin</h1>
        <p>Use the operator key to manage cameras, events, and event galleries.</p>
        {configured ? (
          <form action={login} className="admin-form">
            <label htmlFor="admin-key">Operator key</label>
            <input id="admin-key" name="key" type="password" autoComplete="current-password" required />
            {error ? <p className="form-error">That key did not match.</p> : null}
            <button type="submit">Open dashboard</button>
          </form>
        ) : (
          <p className="admin-warning">
            Admin access is disabled. Configure <code>ADMIN_KEY_SHA256</code> and
            <code> ADMIN_SESSION_SECRET</code> first.
          </p>
        )}
      </section>
    </main>
  );
}
