import { useState, type FormEvent } from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Layers3,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  generateTransaction,
  postTransaction,
  updateTransactionStatus,
  type Status,
  type Transaction,
} from "../domain";
import { TransactionRow } from "../components/TransactionRow";
import { PendingTransactions } from "../components/PendingTransactions";
import { useTransactions } from "../useTransactions";
import { useActivityClock } from "../useActivityClock";

export function Simulator() {
  const activityNow = useActivityClock();
  const {
    transactions: liveTransactions,
    highlights,
    status: connectionStatus,
  } = useTransactions();
  const [amount, setAmount] = useState("1500.50");
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState<Status>("Pending");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activity, setActivity] = useState<
    "manual" | "burst" | "single" | "demo" | null
  >(null);
  const [result, setResult] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const liveById = new Map(
    liveTransactions.map((item) => [item.transactionId, item]),
  );
  const recentLive = recent.map((item) => {
    const live = liveById.get(item.transactionId);
    return live && live.sequence > item.sequence ? live : item;
  });

  async function sendManual(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActivity("manual");
    setResult(null);
    try {
      const item = await postTransaction({
        transactionId: crypto.randomUUID(),
        amount: Number(amount),
        currency,
        status,
        timestamp: new Date().toISOString(),
      });
      setRecent((current) => [item, ...current].slice(0, 5));
      setResult({
        message: "Transaction accepted. Your live monitor is up to date.",
        error: false,
      });
    } catch (error) {
      setResult({
        message:
          error instanceof Error
            ? error.message
            : "Unable to send transaction.",
        error: true,
      });
    } finally {
      setBusy(false);
      setActivity(null);
    }
  }

  async function generate(count: number) {
    setBusy(true);
    setActivity(count === 100 ? "burst" : "single");
    setResult(null);
    setProgress(0);
    let accepted = 0;
    let failed = 0;
    const successes: Transaction[] = [];
    for (let start = 0; start < count; start += 10) {
      const batch = await Promise.allSettled(
        Array.from({ length: Math.min(10, count - start) }, () =>
          postTransaction(generateTransaction()),
        ),
      );
      for (const result of batch) {
        if (result.status === "fulfilled") {
          accepted++;
          successes.push(result.value);
        } else failed++;
      }
      setProgress(accepted + failed);
    }
    setRecent((current) => [...successes.reverse(), ...current].slice(0, 5));
    setResult({
      message: `${accepted} transaction${count > 1 ? "s" : ""} accepted.${failed ? ` ${failed} requests failed; check the backend connection.` : " Watch them arrive in your monitor."}`,
      error: failed > 0,
    });
    setBusy(false);
    setActivity(null);
  }

  async function demonstrateLifecycle() {
    setBusy(true);
    setActivity("demo");
    setResult(null);
    try {
      const pending = await postTransaction({
        ...generateTransaction(),
        status: "Pending",
      });
      setRecent((current) => [pending, ...current].slice(0, 5));
      setResult({
        message:
          "Demo: Pending created. A simulated provider will report Completed in 2 seconds. Watch the same row change in the monitor.",
        error: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const completed = await updateTransactionStatus(
        pending.transactionId,
        "Completed",
      );
      setRecent((current) =>
        current.map((item) =>
          item.transactionId === completed.transactionId ? completed : item,
        ),
      );
      setResult({
        message:
          "Demo complete: the same transaction moved from Pending to Completed. Normal transactions wait for an explicit provider result.",
        error: false,
      });
    } catch (error) {
      setResult({
        message:
          error instanceof Error ? error.message : "Demo request failed.",
        error: true,
      });
    } finally {
      setBusy(false);
      setActivity(null);
    }
  }

  return (
    <main>
      <div className="eyebrow">
        <span />
        SIMULATION WORKSPACE
      </div>
      <div className="page-heading">
        <div>
          <h1>Bring your monitor to life.</h1>
          <p>
            Create a transaction or send a burst of activity to test the flow.
          </p>
        </div>
        <NavLink to="/monitor" className="button secondary">
          Open live monitor
          <ArrowUpRight size={16} />
        </NavLink>
      </div>
      <div className="simulator-grid">
        <section className="form-panel">
          <div className="panel-heading">
            <div>
              <h2>New transaction</h2>
              <p>Send a transaction through the ingestion API.</p>
            </div>
            <span className="panel-icon">
              <Send size={20} />
            </span>
          </div>
          <form
            onSubmit={(event) => {
              void sendManual(event);
            }}
          >
            <label>
              Amount
              <div className="amount-input">
                <span>{currency}</span>
                <input
                  aria-label="Amount"
                  type="number"
                  required
                  min="0.01"
                  max="1000000000"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </label>
            <div className="form-row">
              <label>
                Currency
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                  <option>ILS</option>
                </select>
              </label>
              <label>
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as Status)}
                >
                  <option>Completed</option>
                  <option>Pending</option>
                  <option>Failed</option>
                </select>
              </label>
            </div>
            <div className="form-info">
              <ShieldCheck size={16} />
              <span>
                A unique transaction ID and UTC timestamp are generated
                automatically.
              </span>
            </div>
            <button
              className="button primary full-width"
              disabled={busy}
              type="submit"
            >
              {activity === "manual" ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Send size={17} />
              )}
              Send transaction
              <ArrowRight size={17} />
            </button>
          </form>
        </section>
        <section className="generator-panel">
          <span className="generator-icon">
            <Sparkles size={25} />
          </span>
          <span className="mini-label">PUT IT TO THE TEST</span>
          <h2>
            A little activity.
            <br />
            Or a hundred at once.
          </h2>
          <p>
            Generate realistic mock transactions with a mix of amounts,
            currencies, and statuses.
          </p>
          <button
            className="button secondary full-width"
            disabled={busy}
            onClick={() => {
              void generate(1);
            }}
          >
            <Zap size={16} />
            Generate 1 transaction
            <ArrowUpRight size={16} />
          </button>
          <button
            className="button primary full-width"
            disabled={busy}
            onClick={() => {
              void generate(100);
            }}
          >
            <Layers3 size={17} />
            {activity === "burst"
              ? `Sending… ${progress}/100`
              : "Send a burst of 100"}
            <ArrowRight size={17} />
          </button>
          <small>
            <Activity size={13} />
            Batch of 10 concurrent requests · HTTP POST
          </small>
          <button
            className="button secondary full-width demo-button"
            disabled={busy}
            onClick={() => {
              void demonstrateLifecycle();
            }}
          >
            <Activity size={16} />
            {activity === "demo"
              ? "Demo in progress…"
              : "Run Pending → Completed demo"}
          </button>
        </section>
      </div>
      {result && (
        <div
          role={result.error ? "alert" : "status"}
          className={`notice ${result.error ? "error" : "success"}`}
        >
          {result.error ? <TriangleAlert size={18} /> : <Check size={18} />}
          <span>{result.message}</span>
        </div>
      )}
      <PendingTransactions
        transactions={liveTransactions}
        highlights={highlights}
        status={connectionStatus}
      />
      <section className="recent-panel">
        <div className="panel-heading">
          <div>
            <h2>Recently sent</h2>
            <p>
              Your last five accepted submissions. The pending list above shows
              current live status.
            </p>
          </div>
          <span className="count-pill">{recent.length}</span>
        </div>
        {recent.length ? (
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
                  <th title="The last recorded activity and its age. NEW and UPDATED briefly highlight live changes.">
                    LAST ACTIVITY
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentLive.map((item, index) => (
                  <TransactionRow
                    key={item.transactionId}
                    transaction={item}
                    rowNumber={index + 1}
                    highlight={highlights[item.transactionId]}
                    now={activityNow}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="recent-empty">
            <Send size={20} />
            <span>Your first transaction starts here.</span>
          </div>
        )}
      </section>
      <div className="bottom-note">
        <CircleHelp size={15} />
        <span>
          Open the monitor in another tab to watch new transactions appear in
          real time.
        </span>
      </div>
    </main>
  );
}
