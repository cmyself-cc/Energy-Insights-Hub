# Task 8 Report: LLM Suggestion Generator

## Summary
Implemented `POST /api/feedback/generate-suggestions` — an endpoint that analyzes the latest 100 user feedback entries via LLM and generates keyword/enterprise filtering rule suggestions in the `feedback_rules_suggestions` table.

## Files Changed

### Created: `server/services/feedbackSuggestionGenerator.js`
- Exports `generateSuggestions()` async function
- Reads `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` from env (same pattern as `llmProcessor.js`)
- Uses `fetchWithTimeout` from `../crawlers/utils.js`
- Supports both OpenAI and Anthropic providers via `buildRequest()` / `extractContent()`
- Loads up to 100 recent feedback rows, sends them as JSON to the LLM with a Chinese prompt asking for rule suggestions
- Parses LLM response, inserts suggestions into `feedback_rules_suggestions` table in a transaction
- Returns `{ generated: N }`

### Modified: `server/routes/feedback.js`
- Added import: `import { generateSuggestions } from "../services/feedbackSuggestionGenerator.js";`
- Added route: `POST /generate-suggestions` (async handler, returns `{ data: result }` on success, `{ error: message }` on failure)

## Verification
- Server was already running on port 3001 (existing instance)
- `curl -X POST http://localhost:3001/api/feedback/generate-suggestions` returned `{"data":{"generated":1}}` — endpoint functional, LLM call succeeded, 1 suggestion generated from existing feedback data

## Commit
- `29b4f2d` — `feat(feedback): add LLM suggestion generator`
