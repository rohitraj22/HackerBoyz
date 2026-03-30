# Architecture

## High-level flow

1. User submits a scan request from the React frontend.
2. Express backend receives the request.
3. Backend orchestrator:
   - optionally clones the repository
   - runs TLS scanner
   - runs dependency scanner
   - runs crypto scanner
   - runs API scanner
4. Parsers normalize raw outputs into structured JSON.
5. Risk engine calculates score and severity.
6. CBOM generator builds the cryptographic bill of materials.
7. Gemini service produces:
   - executive summary
   - technical recommendations
   - migration roadmap
   - priority action items
8. Backend stores scan, assets, and recommendations in MongoDB.
9. Frontend displays details and history.

## Design principles

- Controllers stay thin
- Scanners only gather raw data
- Parsers only normalize raw outputs
- Risk engine only scores
- AI service only explains and recommends
- DB models remain simple and query-friendly
