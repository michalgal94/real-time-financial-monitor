# Test summary

## Results

| Check | Result |
| --- | --- |
| Backend unit and integration tests with real Redis | 26 passed, none skipped |
| Frontend unit tests | 58 passed |
| Development browser suite | 10 passed |
| Distributed suite with five backends | 9 passed |
| Browser scenarios against the published app | 10 passed |
| TypeScript/Vite build | Passed |
| .NET Release build and publish | Passed |

The browser runs had no skipped or flaky cases. The published-app check ran the same ten UI scenarios against ASP.NET serving the built React app directly, without Vite.

## What the tests cover:

**Backend:** validation and HTTP responses, processing order, concurrent reads/writes, duplicate IDs, bounded storage, money precision, timestamp round trips, status transitions, safe retries and conflicting outcomes. Storage-failure tests check 503 responses, readiness and liveness.

**Frontend units:** merging and snapshot reconciliation, stale versions, retained limits, formatted-amount search, local/UTC timestamp search, inclusive local date ranges, optional bounds, reversed ranges, invalid timestamps and relative activity ages.

**Browser:** two live viewers, form submission, a responsive 100-item burst, status filters, search, date ranges, pagination, mobile layout, reconnect recovery, Complete/Mark failed actions, animations and reduced motion.

**Distributed:** five separate backend processes share Redis. A client on each receives events from other replicas within five seconds. Tests distribute 100 concurrent writes across the five backends, race final-status updates and require matching snapshots with only one accepted terminal change. Live receive maps are separate from snapshot reads.

Activity checks also cover badge expiration, stable row height, persistent descriptions after reload, relative-age updates and a second backend. Pagination checks cover ten dashboard rows per page, consecutive row positions, filtering and live reordering. Date-range cases combine dates with status/search, clear dates independently, reset pagination and filter live arrivals. They cover UTC, Asia/Jerusalem and the 23-hour day when daylight saving starts in New York, as well as reversed-range validation and mobile layout.

Dependency checks with `npm audit` and NuGet's vulnerable-package listing reported no known vulnerabilities during this run.

## Running the checks

Follow the [README test commands](../README.md#tests). Redis-specific backend cases need `TEST_REDIS_CONNECTION`; without it they are skipped.

The development suite uses ports 5085/5185. The distributed suite uses 5090-5094 and 5183/5184 with its own Redis namespace. They do not reuse the local application's records. Browser JSON reports are written under `artifacts/audit`.

## Deployment checks and limits

Dockerfile stages and deployment YAML were reviewed. YAML parsing and cross-file checks covered replica count, selectors, ports, Redis references, health probes and volume references.

The published application was tested on Windows. Containers, Nginx inside Docker, Kubernetes rollout, Linux permissions and volume provisioning were not tested at runtime. Docker/Kubernetes tools were unavailable in that environment. GitHub Actions repeats the automated suites and builds the Docker image; its result is available in the repository's Actions tab. Container image size has not been measured.
