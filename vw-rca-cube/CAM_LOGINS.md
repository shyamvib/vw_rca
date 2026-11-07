# Client account manager (CAM) logins

A CAM signs in like a rep and gets the **rep view only**, limited to the salespeople paired with them in Cube. No company
dashboard, no Overview, no Business Feed, no Settings.

## Where the pairing comes from
Cube's `internal_user` cube: each salesperson row has `cam_id` / `cam_name` and `supervisor_name` (team lead); a CAM is also a
row, which gives their email. The analytics service reads it on demand (cached 10 minutes), so a pairing change in the
source system reaches the dashboard without a rebuild. If Cube is unreachable and nothing is cached, a CAM sees no reps
(fails closed). Salesperson names are `internal_user.name`, the same name the refresh stores as `clinicMeta.sales`.

## What a CAM can reach
A CAM account is a `repAccounts` row with `cam: true` and `rep` = the CAM's name. The check is in one place,
`engine/camGuard.ts`, applied in `engine/server.ts` before any handler runs:
- only the calls the rep view needs are allowed (deny by default; see `CAM_RULES`);
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
- No clinic search box and no Settings-side actions (marking whitespace, rep windows) for CAMs.
- Both halves must be deployed before the first CAM signs in: the analytics service (guard and pairing) and Convex (the `cam` flag on accounts).
