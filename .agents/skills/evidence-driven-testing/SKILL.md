---
name: evidence-driven-testing
description: >
  Evidence-driven verification of acceptance criteria: run the app, exercise
  real user outcomes, prove them with Cursor RecordScreen, attach and embed
  evidence. Use when the user invokes /evidence-driven-testing, asks for
  acceptance proof, manual verification evidence, or when cloud-implement
  hands off to evidence-driven testing.
---

# Evidence-driven testing

Prove acceptance criteria with **observable product behavior**, not vibes.
Primary proof for GUI flows is a **Cursor `RecordScreen`** capture.

## Completion criterion

Done only when every acceptance criterion is **PASS** or **FAIL with a
repro**, and GUI criteria have a **Cursor RecordScreen** artifact that a
`videoReview` pass confirms shows the claimed steps — attached **and**
embedded where the issue tracker expects inline playback.

## 1. Prep

1. Read the ticket/spec acceptance criteria. Turn each into a checkable
   outcome (user-visible result, not an implementation detail).
2. Run the app the way the project documents (respect project port rules;
   restart the existing process — do not invent sideline ports).
3. Prefer a short focused path that covers the criteria. Target **~60–90s**
   of recording for a single ticket; avoid multi-minute exploratory dumps.

## 2. Record proof (GUI) — mandatory path

For any criterion that needs the browser/UI:

1. **`RecordScreen` → `START_RECORDING`** before the demo actions.
2. Drive the UI with the **`computerUse`** subagent (or equivalent desktop
   browser control) against the running app. Keep the script tight: only
   steps that prove the criteria.
3. **`RecordScreen` → `SAVE_RECORDING`** with a descriptive
   `save_as_filename` (e.g. `saa-120-edit-delete-cursor-recording`).
4. Confirm the saved file under `/opt/cursor/artifacts/` is **H.264 MP4**
   (`ffprobe`: `codec_name=h264`). Cursor RecordScreen already emits this —
   do **not** substitute agent-browser/WebM/VP8 as the primary evidence.
5. Run **`videoReview`** on the MP4. Verify each claimed step is visible.
   If a criterion is missing or unclear, re-record (discard or overwrite) —
   do not attach a video that fails review.
6. Copy the canonical MP4 into the project's gitignored evidence dir
   (KeyPage: `.odw/<issue-id>/videos/`). Keep a short `EVIDENCE.md` with
   pass/fail per criterion and timestamps into the recording.

### Hard rules

- **Canonical GUI proof = Cursor `RecordScreen`.** agent-browser may help
  explore or gather HAR/SQLite side evidence, but must not replace
  RecordScreen as the walkthrough attached for acceptance.
- Prefer **one short recording** that walks the ACs over several long ones.
- Do not ship WebM/VP8 to Linear (or similar) as the playable evidence.

## 3. Non-GUI proof

When a criterion is server/storage/crypto-only: use the cheapest durable
artifact (readonly SQLite query, HAR showing ciphertext-only payloads,
curl + auth checks). Still keep GUI ACs on RecordScreen.

## 4. Publish to Linear (inline embed)

Issue-sidebar attachments alone do **not** inline-play. Mirror the
working pattern:

1. Upload the MP4 via Linear MCP:
   `prepare_attachment_upload` → HTTP `PUT` raw bytes with the signed
   headers → `create_attachment_from_upload`.
2. Post a **Verification evidence** comment that **embeds** the asset with
   markdown image syntax (Linear turns this into an inline player):

   ```markdown
   ## Verification evidence

   ![<issue> Cursor screen recording](<assetUrl from upload>)

   **Verdict:** PASS|FAIL

   | Criterion | Result | Where in recording |
   |---|---|---|
   | … | PASS | ~00:20–00:34 |
   ```

3. Replace prior bad evidence: `delete_attachment` / `delete_comment` for
   WebM or non-embedded uploads, then publish the RecordScreen MP4.
4. Optionally reference `/opt/cursor/artifacts/<file>.mp4` in the PR body
   with a `<video>` tag for the GitHub walkthrough.

## 5. Iterate

On FAIL: fix the product (or the demo setup), re-run typecheck/tests as
the project requires, **re-record** with RecordScreen, re-review, replace
Linear evidence. Repeat until ACs pass or you escalate a blocker.

## 6. Return

Report: pass/fail per criterion, recording path + duration, Linear comment
link/issue id, and any remaining gaps.
