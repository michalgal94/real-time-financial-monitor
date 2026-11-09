import { useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  X,
} from "lucide-react";
import {
  updateTransactionStatus,
  type Transaction,
  type TransactionHighlight,
} from "../domain";
import { type ConnectionStatus } from "../useTransactions";
import { TransactionRow } from "./TransactionRow";

export function PendingTransactions({
  transactions,
  highlights,
  status,
}: {
  transactions: Transaction[];
  highlights: Record<string, TransactionHighlight>;
  status: ConnectionStatus;
}) {
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const pending = transactions.filter((item) => item.status === "Pending");
  const pageCount = Math.max(1, Math.ceil(pending.length / 8));
  const currentPage = Math.min(page, pageCount - 1);

  return (
    <section id="pending" className="recent-panel pending-panel">
      <div className="panel-heading">
        <div>
          <h2>
            Resolve pending transactions{" "}
            <span className="count-pill">{pending.length}</span>
          </h2>
          <p>
            Simulate a provider result for an existing transaction. Its ID,
            amount and currency stay the same.
          </p>
        </div>
      </div>
      <div className="pending-explanation">
        Choose <strong>Complete</strong> for a simulated successful payment, or{" "}
        <strong>Mark failed</strong> for a simulated rejection. Transactions do
        not change status on a timer.
      </div>
      {notice && (
        <div
          className={`notice ${notice.error ? "error" : "success"}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.message}
        </div>
      )}
      {pending.length ? (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col" aria-label="Row number">
                    #
                  </th>
                  <th>TRANSACTION ID</th>
                  <th>AMOUNT</th>
                  <th>CURRENCY</th>
                  <th>STATUS</th>
                  <th>TIMESTAMP</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {pending
                  .slice(currentPage * 8, currentPage * 8 + 8)
                  .map((item, index) => (
                    <TransactionRow
                      key={item.transactionId}
                      transaction={item}
                      rowNumber={currentPage * 8 + index + 1}
                      highlight={highlights[item.transactionId]}
                      actions={
                        <ResolutionActions
                          transaction={item}
                          onResult={setNotice}
                        />
                      }
                    />
                  ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>{pending.length} pending transactions</span>
            <div>
              <button
                aria-label="Previous pending page"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span>
                {currentPage + 1} / {pageCount}
              </span>
              <button
                aria-label="Next pending page"
                disabled={currentPage + 1 >= pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="recent-empty">
          {status === "connected"
            ? "No pending transactions. Send one with Pending selected to try a status update."
            : "Connecting to the transaction feed…"}
        </div>
      )}
    </section>
  );
}

function ResolutionActions({
  transaction,
  onResult,
}: {
  transaction: Transaction;
  onResult: (notice: { message: string; error: boolean }) => void;
}) {
  const [busy, setBusy] = useState(false);
  async function resolve(status: "Completed" | "Failed") {
    setBusy(true);
    try {
      await updateTransactionStatus(transaction.transactionId, status);
      onResult({
        message: `Transaction ${transaction.transactionId.slice(0, 8)} marked ${status.toLowerCase()}. All connected monitors receive the update.`,
        error: false,
      });
    } catch (error) {
      onResult({
        message:
          error instanceof Error
            ? error.message
            : "Could not resolve transaction.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="resolution-actions">
      <button
        className="resolve-complete"
        disabled={busy}
        onClick={() => {
          void resolve("Completed");
        }}
      >
        {busy ? (
          <LoaderCircle size={13} className="spin" />
        ) : (
          <Check size={13} />
        )}
        Complete
      </button>
      <button
        className="resolve-failed"
        disabled={busy}
        onClick={() => {
          void resolve("Failed");
        }}
      >
        <X size={13} />
        Mark failed
      </button>
    </div>
  );
}
