"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface LeagueSettingsFormProps {
  leagueId: string;
  settings: {
    name: string;
    rosterSize: number;
    teamCount: number;
    timerSeconds: number;
    scoringFormat: string;
    draftType: string;
  };
}

// Mirrors create-league-form.tsx's fetch/setState pattern. Sends the full
// set of editable fields on submit (all pre-filled with real current
// values from the page, not creation defaults) - the PATCH endpoint's
// "no schema defaults" rule is about how the server treats OMITTED fields,
// which doesn't apply here since this form always supplies every field it
// displays.
export function LeagueSettingsForm({ leagueId, settings }: LeagueSettingsFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const formData = new FormData(event.currentTarget);
    const response = await fetch(`/api/leagues/${leagueId}`, {
      method: "PATCH",
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
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div>
          <label>
            Name
            <input name="name" defaultValue={settings.name} required />
          </label>
        </div>
        <div>
          <label>
            Roster size
            <input
              name="rosterSize"
              type="number"
              defaultValue={settings.rosterSize}
              min={8}
              max={25}
            />
          </label>
        </div>
        <div>
          <label>
            Team count
            <input
              name="teamCount"
              type="number"
              defaultValue={settings.teamCount}
              min={4}
              max={20}
            />
          </label>
        </div>
        <div>
          <label>
            Timer seconds
            <input
              name="timerSeconds"
              type="number"
              defaultValue={settings.timerSeconds}
              min={10}
              max={300}
            />
          </label>
        </div>
        <div>
          <label>
            Scoring format
            <select name="scoringFormat" defaultValue={settings.scoringFormat}>
              <option value="STANDARD">STANDARD</option>
              <option value="PPR">PPR</option>
              <option value="HALF_PPR">HALF_PPR</option>
            </select>
          </label>
        </div>
        <div>
          <label>
            Draft type
            <select name="draftType" defaultValue={settings.draftType}>
              <option value="SNAKE">SNAKE</option>
              <option value="LINEAR">LINEAR</option>
            </select>
          </label>
        </div>
        <button type="submit">Save settings</button>
      </form>
      {saved && <p>Saved.</p>}
      {error && <pre>{error}</pre>}
    </div>
  );
}
