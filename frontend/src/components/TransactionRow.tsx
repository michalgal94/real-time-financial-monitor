import { memo, type ReactNode } from "react";
import { ArrowDownLeft } from "lucide-react";
import {
  formatAmount,
  formatTimestamp,
  type Transaction,
  type TransactionHighlight,
} from "../domain";
import { LastActivity } from "./LastActivity";

export const TransactionRow = memo(function TransactionRow({
  transaction: t,
  rowNumber,
  highlight,
  actions,
  now = Date.now(),
}: {
  transaction: Transaction;
  rowNumber: number;
  highlight?: TransactionHighlight;
  actions?: ReactNode;
  now?: number;
}) {
  const timestamp = formatTimestamp(t.timestamp);
  return (
    <tr
      className={`transaction-row ${highlight ? `highlight-${highlight.kind} highlight-${t.status.toLowerCase()}` : ""}`}
    >
      <td className="row-number">{rowNumber}</td>
      <td>
        <div className="transaction-id">
          <span className="transaction-icon">
            <ArrowDownLeft size={17} />
          </span>
          <span title={t.transactionId}>
            {t.transactionId.slice(0, 8)}
            <small>…{t.transactionId.slice(-6)}</small>
          </span>
        </div>
      </td>
      <td className="amount">{formatAmount(t.amount, t.currency)}</td>
      <td>
        <span className="currency">{t.currency}</span>
      </td>
      <td>
        <span
          key={highlight?.kind === "updated" ? highlight.sequence : "status"}
          className={`status-badge ${t.status.toLowerCase()} ${highlight?.kind === "updated" ? "status-changed" : ""}`}
        >
          <span />
          {t.status}
        </span>
      </td>
      <td className="timestamp">
        <time dateTime={t.timestamp} title={t.timestamp}>
          {timestamp.time}
          <small>{timestamp.date}</small>
        </time>
      </td>
      <td>
        {actions ?? (
          <LastActivity transaction={t} highlight={highlight} now={now} />
        )}
      </td>
    </tr>
  );
});
