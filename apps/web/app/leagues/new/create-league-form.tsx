"use client";

import { useState } from "react";

export function CreateLeagueForm() {
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formData.get("name"),
        rosterSize: Number(formData.get("rosterSize")),
        teamCount: Number(formData.get("teamCount")),
        timerSeconds: Number(formData.get("timerSeconds")),
        scoringFormat: formData.get("scoringFormat"),
        draftType: formData.get("draftType"),
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
            Name
            <input name="name" required />
          </label>
        </div>
        <div>
          <label>
            Roster size
            <input name="rosterSize" type="number" defaultValue={16} min={8} max={25} />
          </label>
        </div>
        <div>
          <label>
            Team count
            <input name="teamCount" type="number" defaultValue={12} min={4} max={20} />
          </label>
        </div>
        <div>
          <label>
            Timer seconds
            <input name="timerSeconds" type="number" defaultValue={60} min={10} max={300} />
          </label>
        </div>
        <div>
          <label>
            Scoring format
            <select name="scoringFormat" defaultValue="PPR">
              <option value="STANDARD">STANDARD</option>
              <option value="PPR">PPR</option>
              <option value="HALF_PPR">HALF_PPR</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            Draft type
            <select name="draftType" defaultValue="SNAKE">
              <option value="SNAKE">SNAKE</option>
              <option value="LINEAR">LINEAR</option>
            </select>
          </label>
        </div>
        <button type="submit">Create league</button>
      </form>
      {error && <pre>{error}</pre>}
      {result != null && (
        <div>
          <p>
            Invite code: <strong>{(result as { league?: { inviteCode?: string } }).league?.inviteCode}</strong>
          </p>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
