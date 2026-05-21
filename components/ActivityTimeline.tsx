import type { Activity } from "@/lib/data/types";
import { formatDate } from "@/lib/utils";

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return <p className="text-sm text-slate-500">No activity yet.</p>;
  }
  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <div key={activity.id} className="border-l-2 border-sentry-500 pl-3">
          <p className="text-sm font-medium text-ink">{activity.message}</p>
          <p className="mt-1 text-xs text-slate-500">
            {activity.type} · {formatDate(activity.createdAt)}
          </p>
        </div>
      ))}
    </div>
  );
}
