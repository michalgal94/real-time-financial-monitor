import { useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Radio,
  Search,
  ShieldCheck,
  TriangleAlert,
  Wallet,
  Zap,
  ArrowRight,
} from "lucide-react";
import {
  matchesTransactionDateRange,
  matchesTransactionSearch,
  type Status,
} from "../domain";
import { useTransactions } from "../useTransactions";
import { useActivityClock } from "../useActivityClock";
import { TransactionRow } from "../components/TransactionRow";

const PAGE_SIZE = 10;

const labels = {
  connecting: "Connecting",
  connected: "Live connection",
  reconnecting: "Reconnecting",
  offline: "Disconnected",
};

export function Monitor() {
  const activityNow = useActivityClock();
  const { transactions, status, lastSync, error, retentionLimit, highlights } =
    useTransactions();
  const [filter, setFilter] = useState<Status | "All">("All");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const invalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const stats = useMemo(
    () => ({
      completed: transactions.filter((t) => t.status === "Completed").length,
      failed: transactions.filter((t) => t.status === "Failed").length,
      pending: transactions.filter((t) => t.status === "Pending").length,
    }),
    [transactions],
  );
  const filtered = useMemo(
    () =>
      transactions.filter(
        (t) =>
          (filter === "All" || t.status === filter) &&
          matchesTransactionSearch(t, search) &&
          matchesTransactionDateRange(t, dateFrom, dateTo),
      ),
    [transactions, filter, search, dateFrom, dateTo],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);
  return (
    <main>
      <div className="eyebrow">
        <span />
        TRANSACTION MONITOR
      </div>
      <div className="page-heading">
        <div>
          <h1>Every transaction. In view.</h1>
          <p>Your live pulse on financial activity, all in one place.</p>
        </div>
        <NavLink className="button primary" to="/add">
          <Zap size={16} />
          Simulate transactions
          <ArrowUpRight size={16} />
        </NavLink>
      </div>
      <div
        className={`connection-strip ${status !== "connected" ? "not-connected" : ""}`}
      >
        <span className="connection-label">
          <span className="dot" />
          {labels[status]}
        </span>
        <span>
          {status === "connected"
            ? "Transactions appear automatically as they arrive."
            : "We’ll reconnect and recover the latest transactions automatically."}
        </span>
        <span className="sync">
          {lastSync
            ? `Last synced ${lastSync.toLocaleTimeString()}`
            : "Waiting for connection"}
          <Radio size={15} />
        </span>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <section className="stats-grid" aria-label="Transaction summary">
        <Stat
          label="Total transactions"
          value={transactions.length}
          icon={<Wallet size={19} />}
          detail="In the current window"
        />
        <Stat
          label="Completed"
          value={stats.completed}
          icon={<Check size={19} />}
          tone="green"
          detail={`${transactions.length ? Math.round((stats.completed / transactions.length) * 100) : 0}% completion rate`}
        />
        <Stat
          label="Pending"
          value={stats.pending}
          icon={<LoaderCircle size={19} />}
          tone="amber"
          detail="Awaiting resolution"
        />
        <Stat
          label="Failed"
          value={stats.failed}
          icon={<TriangleAlert size={19} />}
          tone="red"
          detail="May need your attention"
        />
      </section>
      <section className="transaction-panel">
        <div className="panel-heading">
          <div>
            <h2>
              Transaction activity{" "}
              <span className="count-pill">{transactions.length}</span>
            </h2>
            <p>A real-time feed of your most recent transactions.</p>
          </div>
          <span className="stream-label">
            <span
              className={`dot ${status !== "connected" ? "muted-dot" : ""}`}
            />
            {status === "connected" ? "STREAMING" : "WAITING"}
          </span>
        </div>
        <div className="table-toolbar">
          <div className="tabs" aria-label="Filter transactions">
            {(["All", "Completed", "Pending", "Failed"] as const).map(
              (item) => (
                <button
                  key={item}
                  className={filter === item ? "selected" : ""}
                  onClick={() => {
                    setFilter(item);
                    setPage(0);
                  }}
                >
                  {item === "All" ? "All transactions" : item}
                  {item === "Failed" && stats.failed > 0 && (
                    <span>{stats.failed}</span>
                  )}
                </button>
              ),
            )}
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search transactions"
              placeholder="Search by ID, amount, currency..."
              title="Search by ID, currency, amount, date or time. Use the displayed date/time or an ISO timestamp."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
            <kbd>⌕</kbd>
          </label>
        </div>
        <div className="date-range-toolbar">
          <div
            className="date-range-controls"
            role="group"
            aria-label="Filter by date range"
          >
            <div className="date-filter">
              <input
                type="date"
                aria-label="From date"
                value={dateFrom}
                max={dateTo || undefined}
                aria-invalid={invalidDateRange}
                aria-describedby={invalidDateRange ? "date-range-error" : undefined}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="date-filter">
              <input
                type="date"
                aria-label="To date"
                value={dateTo}
                min={dateFrom || undefined}
                aria-invalid={invalidDateRange}
                aria-describedby={invalidDateRange ? "date-range-error" : undefined}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPage(0);
                }}
              />
            </div>
            <button
              type="button"
              className="date-range-clear"
              disabled={!dateFrom && !dateTo}
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setPage(0);
              }}
            >
              Clear dates
            </button>
          </div>
          {invalidDateRange && (
            <p id="date-range-error" className="date-range-error" role="alert">
              From date must be on or before To date.
            </p>
          )}
        </div>
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
                <th>
                  TIMESTAMP <span>↓</span>
                </th>
                <th title="The last recorded activity and its age. NEW and UPDATED briefly highlight live changes.">
                  LAST ACTIVITY
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((transaction, index) => (
                <TransactionRow
                  key={transaction.transactionId}
                  transaction={transaction}
                  rowNumber={pageStart + index + 1}
                  highlight={highlights[transaction.transactionId]}
                  now={activityNow}
                />
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">
              <Radio size={27} />
            </span>
            <h3>
              {invalidDateRange
                ? "Check the date range"
                : transactions.length
                  ? "No matching transactions"
                  : "Ready when your transactions are"}
            </h3>
            <p>
              {invalidDateRange
                ? "Choose a start date that is on or before the end date."
                : transactions.length
                  ? "Try another status, search term or date range."
                  : "Start the simulator to see your financial activity flow in live."}
            </p>
            {transactions.length === 0 && (
              <NavLink to="/add" className="text-link">
                Open transaction simulator
                <ArrowRight size={15} />
              </NavLink>
            )}
          </div>
        )}
        <div className="table-footer">
          <span>
            {filtered.length
              ? `Showing ${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, filtered.length)} of ${filtered.length}`
              : "0 transactions"}
            <span className="retention">
              {" "}
              · Latest {retentionLimit.toLocaleString()} retained
            </span>
          </span>
          <div>
            <button
              aria-label="Previous page"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {safePage + 1} / {pageCount}
            </span>
            <button
              aria-label="Next page"
              disabled={safePage + 1 >= pageCount}
              onClick={() => setPage(safePage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
      <div className="bottom-note">
        <ShieldCheck size={15} />
        <span>
          Amounts are shown in their original currency. Summary counts reflect
          the retained transaction window.
        </span>
        <NavLink className="text-link manage-pending" to="/add#pending">
          Manage pending transactions <ArrowRight size={14} />
        </NavLink>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  icon,
  detail,
  tone = "",
}: {
  label: string;
  value: number;
  icon: ReactNode;
  detail: string;
  tone?: string;
}) {
  return (
    <div className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value.toLocaleString()}</strong>
      <small>
        <span className="tiny-dot" />
        {detail}
      </small>
    </div>
  );
}
