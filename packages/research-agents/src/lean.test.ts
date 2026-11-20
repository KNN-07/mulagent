import { describe, expect, it } from "vite-plus/test";
import { parseLeanAxioms, parseLeanDiagnostics } from "./lean.ts";

describe("Lean validation", () => {
  it("accepts standard axioms and rejects transitive sorry and custom axioms", () => {
    expect(
      parseLeanAxioms(
        [
          "'Research.pure' does not depend on any axioms",
          "'Research.choice' depends on axioms: [propext, Classical.choice, Quot.sound]",
          "'Research.theorem'' depends on axioms: [propext,",
          " sorryAx, Research.custom]",
        ].join("\n"),
      ),
    ).toEqual([
      { theorem: "Research.pure", axioms: [], disallowed: [], accepted: true },
      {
        theorem: "Research.choice",
        axioms: ["propext", "Classical.choice", "Quot.sound"],
        disallowed: [],
        accepted: true,
      },
      {
        theorem: "Research.theorem'",
        axioms: ["propext", "sorryAx", "Research.custom"],
        disallowed: ["sorryAx", "Research.custom"],
        accepted: false,
      },
    ]);
    expect(parseLeanAxioms("error: Unknown constant")).toEqual([]);
  });

  it("parses Lake and Lean diagnostic positions and continuation lines", () => {
    expect(
      parseLeanDiagnostics(
        [
          "error: Research/Main.lean:24:12: type mismatch",
          "  expected Nat",
          "Research/Other.lean:2:0: warning: declaration uses `sorry`",
          "error: build failed",
        ].join("\n"),
      ),
    ).toEqual([
      {
        severity: "error",
        file: "Research/Main.lean",
        line: 24,
        column: 12,
        message: "type mismatch\n  expected Nat",
      },
      {
        severity: "warning",
        file: "Research/Other.lean",
        line: 2,
        column: 0,
        message: "declaration uses `sorry`",
      },
      { severity: "error", message: "build failed" },
    ]);
  });
});
