import {
  formatActivityAge,
  formatTimestamp,
  type Transaction,
  type TransactionHighlight,
} from "../domain";

export function LastActivity({
  transaction,
  highlight,
  now,
}: {
  transaction: Transaction;
  highlight?: TransactionHighlight;
  now: number;
}) {
  const activity = transaction.activity;
  const changed = activity?.kind === "StatusChanged";
  const activityTimestamp = activity?.occurredAt ?? transaction.timestamp;
  const occurredAt = formatTimestamp(activityTimestamp);
  let description = "Created";
  if (changed) {
    description = activity.previousStatus
      ? `${activity.previousStatus} → ${transaction.status}`
      : "Status changed";
  } else if (!activity && transaction.status !== "Pending") {
    description = `Recorded as ${transaction.status}`;
  }
  return (
    <div className="last-activity">
      <div className="activity-detail">
        <span className={changed ? "status-history" : undefined}>
          {description}
        </span>
        <span aria-hidden="true"> · </span>
        <time
          dateTime={activityTimestamp}
          title={`${activity ? "Activity time" : "Recorded transaction time"}: ${occurredAt.date} ${occurredAt.time} (local time) · ${activityTimestamp}`}
        >
          {formatActivityAge(activityTimestamp, now)}
        </time>
      </div>
      <div className="activity-indicator">
        {highlight && (
          <span className={`event-label ${highlight.kind}`}>
            {highlight.kind === "new" ? "NEW" : "UPDATED"}
          </span>
        )}
      </div>
    </div>
  );
}
