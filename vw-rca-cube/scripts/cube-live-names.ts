// Prints the name of every cube and view the live Cube serves (one per line), from /cubejs-api/v1/meta.
// Used by deploy-cube-model.sh to make sure a restart would not drop anything that is live today.
//   node --env-file=.env.engine.local --import tsx scripts/cube-live-names.ts
import { baseUrl, token } from "../analytics/cube";

const res = await fetch(`${baseUrl()}/cubejs-api/v1/meta`, { headers: { Authorization: await token() } });
if (!res.ok) throw new Error(`Cube /meta HTTP ${res.status}`);
const meta = (await res.json()) as { cubes?: { name: string }[] };
for (const c of meta.cubes ?? []) console.log(c.name);
