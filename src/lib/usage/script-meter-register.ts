// Import this first in a script run by GitHub Actions. See script-meter.ts.
import { installScriptMeter } from "./script-meter"

if (process.env.USAGE_METER !== "0") installScriptMeter()
