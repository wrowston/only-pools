"use client";

import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Switch } from "@/components/ui/switch";
import { convexErrorMessage } from "@/lib/convexErrorMessage";

type PrefKey =
  | "emailPickReminders"
  | "emailPoolUpdates"
  | "emailWeeklySummary";

const ROWS: Array<{ key: PrefKey; title: string; description: string }> = [
  {
    key: "emailPickReminders",
    title: "Pick reminders",
    description:
      "One email per pool week, 24 hours before the first game, only if you still need picks.",
  },
  {
    key: "emailPoolUpdates",
    title: "Pool updates",
    description: "Description and banner changes in pools you belong to.",
  },
  {
    key: "emailWeeklySummary",
    title: "Weekly summary",
    description:
      "Tuesday morning digest of survivor outcomes and confidence standings across your pools.",
  },
];

export function NotificationSettingsClient() {
  const { isSignedIn } = useAuth();
  const prefs = useQuery(
    api.notificationPreferences.getMyNotificationPreferences,
    isSignedIn ? {} : "skip",
  );
  const updatePrefs = useMutation(
    api.notificationPreferences.updateMyNotificationPreferences,
  );
  const [local, setLocal] = useState<{
    emailPickReminders: boolean;
    emailPoolUpdates: boolean;
    emailWeeklySummary: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (prefs) setLocal(prefs);
  }, [prefs]);

  if (!isSignedIn) {
    return (
      <p className="text-[14px] text-op-secondary">
        Sign in to manage email notifications.
      </p>
    );
  }

  if (!local) {
    return (
      <p className="text-[14px] text-op-secondary">Loading preferences…</p>
    );
  }

  async function setPref(key: PrefKey, value: boolean) {
    if (!local || saving || local[key] === value) return;
    const previous = local;
    const next = { ...local, [key]: value };
    setLocal(next);
    setSaving(true);
    setError(null);
    try {
      const saved = await updatePrefs({ [key]: value });
      setLocal(saved);
    } catch (err) {
      setLocal(previous);
      setError(convexErrorMessage(err, "Could not save preferences"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-4">
        {ROWS.map((row) => (
          <li
            key={row.key}
            className="flex items-start justify-between gap-4 border-b border-op-border pb-4"
          >
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-op-text">{row.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-op-secondary">
                {row.description}
              </p>
            </div>
            <label className="flex shrink-0 items-center gap-2 pt-0.5 text-[13px] text-op-secondary">
              <Switch
                checked={local[row.key]}
                disabled={saving}
                onCheckedChange={(checked) => void setPref(row.key, checked)}
                aria-label={row.title}
              />
              {local[row.key] ? "On" : "Off"}
            </label>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="text-[13px] text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-[12px] text-op-secondary">
        Emails send from notifications@tryonlypools.com. Replies go to
        will@tryonlypools.com.
      </p>
    </div>
  );
}
