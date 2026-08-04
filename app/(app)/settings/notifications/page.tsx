import { NotificationSettingsClient } from "@/components/NotificationSettingsClient";

export default function NotificationSettingsPage() {
  return (
    <main className="mx-auto w-full max-w-[640px] px-5 py-10 sm:px-8">
      <h1 className="text-[1.75rem] font-medium tracking-tight text-op-text">
        Email notifications
      </h1>
      <p className="mt-2 text-[14px] text-op-secondary">
        Choose which Only Pools emails you receive. All are on by default.
      </p>
      <div className="mt-8">
        <NotificationSettingsClient />
      </div>
    </main>
  );
}
