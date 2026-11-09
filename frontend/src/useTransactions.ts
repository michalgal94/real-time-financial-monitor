import { useEffect, useState } from "react";
import {
  HubConnectionBuilder,
  HttpTransportType,
  LogLevel,
} from "@microsoft/signalr";
import {
  MAX_RECORDS,
  mergeTransactions,
  reconcileSnapshot,
  type Snapshot,
  type Transaction,
  type TransactionHighlight,
} from "./domain";

export type ConnectionStatus =
  "connecting" | "connected" | "reconnecting" | "offline";

export function useTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retentionLimit, setRetentionLimit] = useState(MAX_RECORDS);
  const [highlights, setHighlights] = useState<
    Record<string, TransactionHighlight>
  >({});

  useEffect(() => {
    let disposed = false;
    let syncing = false;
    let pending: Transaction[] = [];
    let capacity = MAX_RECORDS;
    let current: Transaction[] = [];
    let hydrated = false;
    let activeHighlights: Record<string, TransactionHighlight> = {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connection = new HubConnectionBuilder()
      // WebSockets with skipNegotiation avoid sticky sessions; the proxy must allow upgrades.
      .withUrl("/hubs/transactions", {
        transport: HttpTransportType.WebSockets,
        skipNegotiation: true,
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 20000])
      .configureLogging(LogLevel.Warning)
      .build();

    function commit(next: Transaction[], animate: boolean) {
      if (animate) {
        const previous = new Map(
          current.map((item) => [item.transactionId, item]),
        );
        const updated = { ...activeHighlights };
        for (const item of next) {
          const old = previous.get(item.transactionId);
          if (
            !old ||
            (item.sequence > old.sequence && old.status !== item.status)
          ) {
            updated[item.transactionId] = {
              kind:
                item.activity?.kind === "StatusChanged" || old
                  ? "updated"
                  : "new",
              sequence: item.sequence,
              previousStatus: item.activity?.previousStatus ?? old?.status,
              expiresAt: Date.now() + 4200,
            };
          }
        }
        const retained = new Set(next.map((item) => item.transactionId));
        activeHighlights = Object.fromEntries(
          Object.entries(updated).filter(([id]) => retained.has(id)),
        );
        setHighlights(activeHighlights);
      }
      current = next;
      setTransactions(next);
    }

    connection.on("TransactionUpdated", (item: Transaction) => {
      if (!disposed) pending = mergeTransactions(pending, [item], capacity);
    });

    async function synchronize() {
      if (syncing || disposed) return;
      syncing = true;
      // Clear old events so a restarted Memory store can begin its sequence at 1.
      pending = [];
      try {
        const snapshot = await connection.invoke<Snapshot>("GetSnapshot");
        if (!disposed) {
          capacity = snapshot.capacity;
          setRetentionLimit(snapshot.capacity);
          const reconciled = reconcileSnapshot(snapshot, pending);
          pending = [];
          commit(reconciled, hydrated);
          hydrated = true;
          setLastSync(new Date());
          setError(null);
        }
      } catch {
        if (!disposed)
          setError("Could not synchronize. Retrying automatically.");
      } finally {
        syncing = false;
      }
    }

    async function start() {
      if (disposed) return;
      setStatus("connecting");
      try {
        await connection.start();
        if (disposed) {
          await connection.stop();
          return;
        }
        setStatus("connected");
        await synchronize();
      } catch {
        if (!disposed) {
          setStatus("offline");
          retry = setTimeout(() => {
            void start();
          }, 3000);
        }
      }
    }

    connection.onreconnecting(() => {
      if (!disposed) setStatus("reconnecting");
    });
    connection.onreconnected(() => {
      if (!disposed) {
        setStatus("connected");
        void synchronize();
      }
    });
    connection.onclose(() => {
      if (!disposed) {
        setStatus("offline");
        retry = setTimeout(() => {
          void start();
        }, 3000);
      }
    });

    const flush = setInterval(() => {
      if (disposed || syncing || pending.length === 0) return;
      const batch = pending;
      pending = [];
      commit(mergeTransactions(current, batch, capacity), true);
      setLastSync(new Date());
    }, 100);
    const highlightCleanup = setInterval(() => {
      const retained = Object.fromEntries(
        Object.entries(activeHighlights).filter(
          ([, item]) => item.expiresAt > Date.now(),
        ),
      );
      if (
        Object.keys(retained).length !== Object.keys(activeHighlights).length
      ) {
        activeHighlights = retained;
        setHighlights(retained);
      }
    }, 250);
    const recovery = setInterval(() => {
      if (connection.state === "Connected") void synchronize();
    }, 15000);
    void start();
    return () => {
      disposed = true;
      clearTimeout(retry);
      clearInterval(flush);
      clearInterval(recovery);
      clearInterval(highlightCleanup);
      connection.off("TransactionUpdated");
      void connection.stop();
    };
  }, []);

  return { transactions, status, lastSync, error, retentionLimit, highlights };
}
