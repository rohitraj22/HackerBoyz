# Quantum Scanner App

Quantum Scanner App is a full-stack cyber and cryptographic posture platform focused on discovery, PQC readiness, CBOM intelligence, enterprise rating, and operational reporting.

Core stack:
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: MongoDB + Mongoose
- Authentication: JWT in HttpOnly cookie
- AI summarization/recommendations: Gemini (with deterministic fallback)
- Report generation: PDFKit
- Scheduled delivery: Nodemailer SMTP

## What This Project Does

The platform provides:
- Manual scan execution for domain/API targets
- Asset inventory normalization across domains, APIs, IPs, certificates, software
- Discovery graph with inferred fallback relations
- CBOM snapshots and protocol/cipher/key-length analytics
- PQC posture grading and migration prioritization
- Enterprise cyber rating on a 0-1000 scale
- Executive/on-demand/scheduled reporting workflows
- Scheduled report generation and email delivery with attachments (PDF/JSON/CSV)

## Recent Changes (March 2026)

- Report PDFs are now report-type specific (Executive, Asset Discovery, Asset Inventory, CBOM, PQC Posture, Cyber Rating), not a shared generic template.
- PDF output has a refreshed visual style: branded hero header, metric ribbons, styled section cards, and improved typography/spacing.
- PQC Posture data is user-scoped: users only see assets/scans tied to their own account.
- Cyber Rating data is user-scoped: enterprise score and rating assets are calculated from the logged-in user's scans/assets only.
- Reporting data is user-scoped: report generation, downloads, and scheduled report asset selection are restricted to the report owner's scan scope.

## Repository Layout

- frontend: React application and dashboard UI
- backend: Express API, scoring logic, persistence, scheduler
- shared: shared constants and schema files
- docs: architecture notes
- tools: scanner binaries/scripts path area
- backend/temp: temporary repositories and extracted scan artifacts

## Getting Started

### Prerequisites

- Node.js 18+ recommended
- npm 9+ recommended
- MongoDB running locally or remotely

### Install

```bash
npm install
npm run install:all
```

### Environment Configuration

Create/update backend/.env with these values:

```env
NODE_ENV
PORT=5000
MONGO_URI
CLIENT_URL

JWT_SECRET

GEMINI_API_KEY

SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM

TLS_ANALYZER_PATH=./tools/tlsanalyzer.exe
CRYPTODEPS_PATH=./tools/cryptodeps.exe
CRYPTOSCAN_PATH=./tools/cryptoscan.exe
```

Notes:
- SMTP is required only for scheduled email delivery.
- If GEMINI_API_KEY is empty, the system uses fallback recommendation/summary logic.
- TLS scanner binary can be missing; backend falls back to native TLS probing.

### Run

Development (frontend + backend):

```bash
npm run dev
```

Frontend build:

```bash
npm --prefix frontend run build
```

Backend start:

```bash
npm --prefix backend run start
```

Health check:

```bash
GET /health
```

## Authentication Model

- Register/Login endpoints issue JWT cookie named token.
- Cookie is HttpOnly, 7-day expiry, SameSite lax in development and none in production.
- Protected routes require token cookie and valid user lookup.

Auth endpoints:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/auth/me

## API Surface (Current)

### Scan APIs

- POST /api/scans/run
- GET /api/scans
- GET /api/scans/:id
- DELETE /api/scans/:id

### Report APIs (scan-level)

- GET /api/:id/cbom
- GET /api/:id/report
- POST /api/recommendations/:scanId/regenerate

### Dashboard APIs

- GET /api/home/summary
- GET /api/history

### Inventory APIs

- GET /api/inventory/summary
- GET /api/inventory/assets
- GET /api/inventory/assets/:id
- PATCH /api/inventory/assets/:id/status

### Discovery APIs

- GET /api/discovery/graph
- POST /api/discovery/search
- POST /api/discovery/run
- GET /api/discovery/asset/:id/related

### CBOM APIs

- GET /api/cbom/latest
- GET /api/cbom/:scanId
- POST /api/cbom/:scanId/rebuild

### PQC APIs

- GET /api/pqc/overview
- GET /api/pqc/assets

### Rating APIs

- GET /api/rating/enterprise
- GET /api/rating/assets
- POST /api/rating/recalculate
- POST /api/rating/recalculate/:scanId

### Reporting APIs

- GET /api/reporting/options
- POST /api/reporting/generate
- GET /api/reporting/generated
- GET /api/reporting/generated/:id/download
- POST /api/reporting/schedules
- GET /api/reporting/schedules
- PATCH /api/reporting/schedules/:id
- DELETE /api/reporting/schedules/:id

## End-to-End Backend Flow

1. Frontend triggers POST /api/scans/run.
2. Backend executes scan orchestrator:
	 - TLS scan (external binary or native fallback)
	 - API probe (TLS + HTTP headers/status)
	 - Dependency and crypto raw parsers (currently repository scanning disabled by default in orchestrator)
3. Risk engine computes score, level, and findings.
4. CBOM generator builds normalized cryptographic asset payload.
5. Recommendation engine asks Gemini or uses fallback.
6. Enriched assets are built with host intel, TLS, certificate, software, and dedup logic.
7. Scan, assets, recommendation, and report are persisted.

## Detailed Logic and Calculations

This section documents the exact major calculations used in code.

### 1) Risk Engine (0-100 safety score)

Source: backend/src/services/risk/riskEngine.js

Risk engine accumulates riskPoints, clamps to [0, 100], then computes:

safetyScore = 100 - riskPoints

Risk-level bands (by riskPoints):
- Critical: >= 75
- High: >= 50
- Moderate: >= 25
- Low: < 25

Risk point contributions:
- TLS version:
	- TLS 1.0: +40
	- TLS 1.1: +30
	- TLS 1.2: +10
	- TLS 1.3: +0
- Key exchange:
	- RSA signal: +25
	- ECDHE/X25519 signal: +20 (not PQ-safe by itself)
- Signature:
	- RSA/ECDSA/SHA1 signal: +20
- Cipher mode:
	- CBC signal: +10
- Dependency text signals:
	- OpenSSL mention: +10
	- RSA/ECDSA mention: +10
- Crypto findings text signals:
	- SHA1 mention: +15
	- Certificate handling mention: +5
- API target unreachable/error (status >= 400 or 0): +5

### 2) Asset Severity Derivation

Source: backend/src/utils/securityDerivation.js

If explicit severity exists in asset fields, it is used. Otherwise derived score is built:
- Weak protocol (SSL/TLS1.0/TLS1.1): +45
- Weak cipher (3DES/RC4/DES/MD5/SHA1/CBC): +30
- Key length:
	- < 1024: +45
	- >= 1024 and < 2048: +25
- Certificate lifetime:
	- Expired: +40
	- <= 15 days: +28
	- <= 30 days: +15

Severity mapping:
- score >= 70: critical
- score >= 45: high
- score >= 20: moderate
- else: low

### 3) Asset Security Score (0-100)

Source: backend/src/utils/securityDerivation.js

Base score starts at 100 and subtracts penalties:
- Weak protocol: -30
- Weak cipher: -22
- Key length:
	- < 1024: -30
	- >= 1024 and < 2048: -15
- Certificate lifetime:
	- Expired: -25
	- <= 15 days: -18
	- <= 30 days: -10

Final score is clamped and rounded to [0, 100].

### 4) PQC Grade and Support Derivation

Source: backend/src/utils/securityDerivation.js

Explicit pqc.grade and pqc.supportStatus are honored if valid. Otherwise derived logic uses:
- asset type inference
- TLS version (with assumptions for domain/api when missing)
- cipher quality
- resolved key length

Derivation rules:
- critical:
	- SSL present OR TLS1.0 explicitly present OR key length < 1024
- legacy:
	- TLS1.1 OR assumed TLS fallback OR weak cipher OR key length < 2048
- elite/ready:
	- TLS1.3 AND modern cipher AND key length >= 3072
- standard/partial: fallback

PQC migration priority mapping:
- critical -> Immediate
- legacy -> High
- standard -> Medium
- elite -> Low

### 5) Key-Length Resolution Heuristics for PQC View

Source: backend/src/controllers/pqcController.js

Key length is resolved from many candidate fields, then fallback estimations:
- Direct candidates from asset and metadata fields
- Cipher material estimation:
	- Parses RSA/ECDH/ECDSA curve bits and AES variants
	- chacha20 implies 256-bit class signal
- API token entropy estimation:
	- Hex/base64 token entropy converted to bit estimate

Resolution source is tracked as one of:
- direct
- cipher_estimate
- token_entropy_estimate
- missing

### 6) PQC Overview Aggregation

Source: backend/src/controllers/pqcController.js

For scoped assets:
- Crypto metadata can be merged from certificate assets to related domain/api assets.
- Each asset is enriched with normalized fields, PQC grade/support, severity, and migration priority.
- Grade counts are converted to application status percentages.
- Risk overview takes top severe assets.
- Weak protocol/cipher counts and key-length distribution are computed.
- AI recommendations and executive summary are generated from the aggregated facts.

User scope behavior:
- PQC endpoints use the authenticated user's scan IDs only.
- scanId query handling:
	- latest: latest scan for authenticated user
	- specific scanId: only if the scan belongs to authenticated user
	- omitted: all scans for authenticated user

### 7) CBOM Generation Logic

Source: backend/src/services/cbom/cbomGenerator.js and backend/src/controllers/cbomController.js

Per scan, CBOM includes:
- domain asset entry if domain target exists
- api asset entry if apiEndpoint target exists

CBOM asset quantum_safe is derived from risk context:
- Low risk level or score >= 75 -> true
- Moderate or score in [50, 75) -> null
- otherwise -> false

Snapshot analytics compute:
- applications count (unique app/host/domain/name)
- certificate count
- weakCryptography count (weak protocol/cipher)
- certificateIssues count (expired)
- key length buckets
- cipher usage ranking
- authority ranking
- protocol distribution

### 8) Enterprise Rating (0-1000)

Source: backend/src/controllers/ratingController.js

The rating pipeline combines three dimensions:
- External Attack Surface score (0-100)
- Internal Controls score (0-100)
- Threat Context score (0-100)

Weighted base:

weightedBase = 0.5 * external + 0.5 * internal

Threat deduction:

threatDeduction = ((100 - threat) / 100) * 15

Final 0-100 score:

final0to100 = clamp(weightedBase - threatDeduction, 0, 100)

Normalized to 0-1000:
- Raw enterprise max is 950
- Linear scaling: normalized = round(raw * 1000 / 950)

Tier labels:
- 800-1000: Elite-PQC
- 400-799: Standard
- 211-399: Legacy
- < 211: Critical

External Attack Surface details:
- Weak TLS protocol penalties
- Weak cipher penalties
- Low key-length penalties
- Expired/soon-expiring certificate penalties
- Severity-based penalties
- MTTP penalty based on unresolved high/critical finding age

Internal Controls details:
- If questionnaire numeric payload exists in scan metadata/report, normalized average is used.
- Else proxy score is derived from:
	- resolved status ratio
	- owner coverage ratio
	- TLS policy coverage ratio

Threat Context details:
- Text signals for compromise markers (botnet, malware, breach, ransomware, etc.)
- Critical exposures and unresolved high-risk counts contribute deductions.

User scope behavior:
- Enterprise rating and rating asset endpoints are computed from authenticated user's scans/assets only.
- Recalculation is restricted to authenticated user's scans; recalculation of another user's scan is blocked.

### 9) Home Dashboard KPIs

Source: backend/src/controllers/homeController.js

Computed metrics include:
- totalAssets, totalScans
- averageScore from scans
- publicWebApps, apis, servers by inferred type
- expiringCertificates in next 30 days
- highRiskAssets count based on derived severity
- severity breakdown by scan riskLevel

### 10) Inventory Logic

Source: backend/src/controllers/inventoryController.js

- Summary buckets assets into domain, certificate, ip, software.
- Listing supports type, status, text search (name/host/domain/commonName/software/ip/subnet/CA/owner/url).
- Asset status update supports only:
	- new
	- false_positive
	- confirmed
	- resolved

### 11) Discovery Logic

Sources:
- backend/src/services/discovery/discoveryRunService.js
- backend/src/controllers/discoveryController.js

Discovery capabilities:
- Manual target discovery for domain/api.
- DNS A/AAAA resolution to create ip assets and resolves_to relations.
- HTTP reachability probe to create webapp/api metadata.
- TLS probe to populate protocol/cipher/certificate/key fields.
- Certificate asset creation from TLS probe.
- Asset relations persisted in AssetRelation with confidence [0,1].

Graph assembly behavior:
- Uses stored relations if present.
- Infers fallback edges when sparse.
- Adds virtual nodes from signals when graph is single-node and relationless.
- Returns highlights for high/critical assets.

### 12) Reporting and Executive PDF Logic

Source: backend/src/controllers/reportingController.js

Generated reports:
- Report types available from /api/reporting/options
- format in [pdf, json, csv]
- delivery status set to queued-for-delivery when delivery email exists, else generated

User scope behavior:
- Report generation and download use authenticated user's scan scope only.
- If scanId is provided during generation, it must belong to authenticated user.
- For non-latest scope, assets are restricted to authenticated user's scan IDs (no global asset fallback).

PDF behavior:
- PDF is report-type specific and rendered with separate sections per type:
	- executive-summary
	- asset-discovery
	- asset-inventory
	- cbom
	- pqc-posture
	- cyber-rating
- PDF style includes a branded hero block, KPI ribbon, styled section cards, and improved metric/bullet rendering.

Action plan generation rules include:
- Critical assets present -> 24h remediation planning action
- Unresolved high-risk assets -> closure sprint action
- Legacy/critical PQC counts -> migration prioritization action
- Certificate expiry and weak protocol/cipher findings -> direct remediation actions

### 13) Scheduled Reporting and Email Delivery Logic

Sources:
- backend/src/controllers/reportingController.js
- backend/src/services/reports/scheduleRunner.js

Schedule creation/update:
- delivery emails normalized (array/string/comma-separated -> trimmed lowercase list)
- delivery format validated to one of pdf/json/csv
- nextRunAt is validated and shifted forward if in the past using frequency cycle
- frequency supports daily/weekly/monthly

Runner behavior:
- Background poll every 60 seconds
- Picks due schedules where nextRunAt <= now and isActive = true
- Generates report record and AI summary
- Builds attachment by selected format:
	- pdf: PDFKit document
	- json: structured JSON payload
	- csv: asset rows
- Sends email with explicit SMTP envelope recipients from schedule delivery email list
- On success sets deliveryStatus to sent
- Advances nextRunAt from current time to avoid backlog burst behavior

User scope behavior:
- Scheduled report runner resolves assets from the schedule owner's scans only.
- No cross-user/global asset inclusion is used for scheduled report attachments.

## AI Behavior

Two AI layers are used:

1) Recommendation generation (scan report recommendations)
- Source: backend/src/services/ai/geminiService.js
- Uses prompt from backend/src/services/ai/prompts.js
- Expects strict JSON response:
	- executiveSummary
	- technicalRecommendations[]
	- migrationPlan[]
	- priorityActions[]
- If Gemini key missing, API failure, or parse failure, fallback recommendations are returned.

2) Dashboard summaries
- Source: backend/src/services/ai/dashboardAiService.js
- generateAiSummary accepts title, facts, style, extraInstructions, fallback.
- If known Gemini methods are unavailable/fail, fallback text is returned.

## Data Models (Key Fields)

### Scan
- status, summary, overallRiskScore, riskLevel, findings, warnings
- cbom, report, scorecard, metadata

### Asset
- assetType, status
- domain/api/ip/software/certificate fields
- crypto fields: tlsVersion, protocol, cipherSuite, cipher, keyExchange, signature, keyLength
- severity/riskSeverity, quantumSafe, pqc object
- metadata free-form

### Recommendation
- executiveSummary
- technicalRecommendations[]
- migrationPlan[]
- priorityActions[]
- rawModelOutput

### ReportSchedule
- name, reportType, frequency, assetFilter, includedSections
- delivery: email[], savePath, format, downloadableLink
- timezone, nextRunAt, isActive

### GeneratedReport
- reportType, format, includedSections
- storagePath, deliveryStatus
- aiExecutiveSummary, metadata

### CBOMSnapshot
- totals, keyLengthDistribution, cipherUsage, authorities, protocolDistribution, rows, aiSummary

### AssetRelation
- sourceAssetId, targetAssetId, relationType, confidence, metadata

## Frontend Application Notes

Primary pages include:
- Home
- Asset Discovery
- Asset Inventory
- CBOM
- Posture of PQC
- Cyber Rating
- Reporting (Executive, Scheduled, On-Demand in-tab workflow)
- History

Auth behavior:
- Public-only routes for login/register.
- ProtectedRoute wrapper for all dashboard pages.

Axios client behavior:
- baseURL is root
- withCredentials true for cookie-based auth
- errors normalized from multiple backend payload shapes

## Known Operational Notes

- Repository dependency/crypto scanner execution is currently disabled in orchestrator by default (safe placeholder response), while parser and risk paths remain in place.
- TLS scanning is resilient:
	- external binary when available
	- native TLS probe fallback when binary missing/not executable/failing
- Cipher enumeration attempts local tools (nmap/sslscan/testssl), node probe, then SSL Labs API.
- Scheduled reports require valid SMTP config and backend process running.

## Troubleshooting

### Frontend build fails with vite not found

Run:

```bash
npm --prefix frontend install
```

### Scheduled reports do not email

Check:
- SMTP_* variables in backend/.env
- backend process restarted after env update
- schedule has delivery.email and isActive true
- nextRunAt is due or passed

### Not authorized responses

Check:
- JWT_SECRET configured
- token cookie present
- CORS origin equals CLIENT_URL and credentials enabled

### TLS tool execution errors

Check:
- TLS_ANALYZER_PATH exists
- file executable permissions
- OS compatibility of scanner binary

## Security Notes

- Use strong JWT_SECRET in production.
- Set secure cookie behavior with HTTPS and production origin settings.
- Restrict CORS CLIENT_URL to trusted frontend origin.
- Never commit real secrets in backend/.env.

## Scripts

Root:
- npm run install:all
- npm run dev
- npm run build
- npm run start

Backend:
- npm --prefix backend run dev
- npm --prefix backend run start

Frontend:
- npm --prefix frontend run dev
- npm --prefix frontend run build
- npm --prefix frontend run preview

## Versioning and Scope

This README documents the current repository logic, including:
- PQC calculations and grading
- Enterprise rating formulas and thresholds
- CBOM derivations
- reporting and scheduled email workflows
- recommendation and summary generation behavior

If any controller/service logic changes, update this README in the same change set to keep formulas and endpoint behavior aligned.
