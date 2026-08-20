"use client";

import { useState } from "react";

export function JoinLeagueForm() {
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/leagues/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteCode: formData.get("inviteCode"),
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      setError(JSON.stringify(body, null, 2));
      return;
    }
    setResult(body);
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            Invite code
            <input name="inviteCode" required maxLength={8} />
          </label>
        </div>
        <button type="submit">Join league</button>
      </form>
      {error && <pre>{error}</pre>}
      {result != null && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
