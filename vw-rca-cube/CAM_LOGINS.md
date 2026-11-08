# Client account manager (CAM) logins

A CAM signs in like a rep and gets the **rep view only**, limited to the salespeople paired with them in Cube. No company
dashboard, no Overview, no Business Feed, no Settings.

## Where the pairing comes from
The order rows in Cube (`rfm_orders`: `sales_id`, `cam_id`, `team_lead`). The live `internal_user` table has no CAM column
(Cube errors with "Name CAM_id not found inside internal_user"), so the pairing is derived from orders: a CAM is paired with a
salesperson when the CAM's id is on at least 25% of that salesperson's orders in the last 180 days (`SHARE` and
`WINDOW_DAYS` in `engine/cams.ts`). A stray order does not hand a CAM someone's whole book. The CAM's name and email come from
`internal_user` by id; salesperson names are `internal_user.name`, the same name the refresh stores as `clinicMeta.sales`.
The analytics service reads it on demand (cached 10 minutes), so a change reaches the dashboard without a rebuild. If Cube is
unreachable and nothing is cached, a CAM sees no reps (fails closed). `GET /admin/cams` shows the result, plus an `unmatched` list: CAM ids on orders that have no `internal_user` row (no name or
email to match a login to). Add such a CAM to `engine/camOverrides.ts` (id → name and email); an `internal_user` row always wins.
`GET /admin/cams?debug=Name,Name` shows the order shares behind anyone's pairing.

## What a CAM can reach
A CAM account is a `repAccounts` row with `cam: true` and `rep` = the CAM's name. The check is in one place,
`engine/camGuard.ts`, applied in `engine/server.ts` before any handler runs:
- only the calls the rep view needs are allowed (deny by default; see `CAM_RULES`). That includes `bridge:bridge`, the page's first call
  (the list of periods); every rep login makes it too, and it holds company-level totals but no clinic or provider rows;
- `sales` must be exactly one of the CAM's reps (not another rep, not `team:*`, not empty);
- `teamLead` is refused everywhere;
- clinic ids must belong to one of the CAM's reps; the rep and provider lists are cut down to the CAM's reps;
- Convex-side functions (whitespace marks, plans) see a CAM as a rep named after the CAM, which owns no clinics.

Tests: `node --experimental-strip-types --test scripts/cam-guard.test.ts` (or `bun test`).

## Creating the logins
```
SERVICE_URL=https://<engine-url> ADMIN_SECRET=... node scripts/cam-logins.mjs                  # list the CAMs only
SERVICE_URL=... ADMIN_SECRET=... node scripts/cam-logins.mjs --create --out ~/cam-logins.csv --prod
```
`--create` makes an account for each CAM with an email, with a generated one-time password written to the CSV (owner-only
file, never to the screen or the repo). Existing accounts keep their password. Settings → Rep logins can still change or
remove a CAM's login; set a new password there to replace a one-time one.

## Known limits
- A CAM opens one rep at a time. There is no combined "all my reps" book yet (team scopes are keyed on team lead, and a CAM's
  reps can span several leads).
- Clinic and provider search work, limited to the CAM's reps: the clinic search runs once per paired rep and merges the hits (each
  ranked inside that rep's own book); provider hits are cut down to the CAM's reps, and a provider card opens only when every
  salesperson on the provider's recent orders is one of the CAM's reps.
- No Settings-side actions for CAMs (marking whitespace, rep windows).
- Both halves must be deployed before the first CAM signs in: the analytics service (guard and pairing) and Convex (the `cam` flag on accounts).

## Do the numbers match the rep view?
A CAM's calls run the same handlers a rep's own view does, with `sales` set to the rep, so the figures are the same. Two things are not
the same by design, and `scripts/cam-compare.mjs` checks the rest:
- **Date window.** Each login (by email) can have its own saved date window, falling back to the team window. A CAM who has not picked
  one sees the team window; a rep who picked a personal window sees that. Numbers differ only in that case.
- **Leaderboard and rank.** A rep sees every rep on the leaderboard (their rank is among everyone), so a CAM gets the same rows. Only the
  rep *picker* is limited to the CAM's reps.

`scripts/cam-compare.mjs` signs in as a CAM and as the shared team login, asks the same questions for each of the CAM's reps, diffs every
number (this week, month, quarter and the whole window), and checks the lock holds (another rep, a team scope, the company feed, refresh
must all be refused). Passwords come from environment variables; it only reads data.
