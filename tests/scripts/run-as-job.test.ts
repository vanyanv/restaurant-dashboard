import { describe, expect, it } from "vitest"
import { parseArgs } from "../../scripts/run-as-job"

describe("run-as-job parseArgs", () => {
  it("splits the job name from the command at --", () => {
    expect(parseArgs(["db.backup", "--", "bash", "x.sh"])).toEqual({
      jobName: "db.backup",
      command: ["bash", "x.sh"],
    })
  })
  it("refuses a missing name or command", () => {
    expect(() => parseArgs(["db.backup"])).toThrow(/usage/)
    expect(() => parseArgs(["--", "bash"])).toThrow(/usage/)
  })
})
