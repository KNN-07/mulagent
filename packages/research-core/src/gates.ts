import type { ApprovalMode, Gate, GateKind } from "@t3tools/contracts";

export function needsApproval(mode: ApprovalMode, kind: GateKind, risky = kind !== "question") {
  return kind === "budget" || mode === "ask-always" || (mode === "ask-risky" && risky);
}

export function exceedsGpuBudget(gpuHours: number, threshold = 20) {
  if (![gpuHours, threshold].every((n) => Number.isFinite(n) && n >= 0))
    throw new Error("Invalid GPU-hour budget");
  return gpuHours > threshold;
}

export function openGate(input: Omit<Gate, "status" | "answer" | "answeredAt">): Gate {
  if (new Set(input.options.map((o) => o.id)).size !== input.options.length)
    throw new Error("Duplicate option ID");
  if (!input.multiSelect && input.options.filter((o) => o.recommended).length > 1)
    throw new Error("Multiple recommendations for single selection");
  return { ...input, status: "open" };
}

export function resolveGate(gate: Gate, answer: Gate["answer"] | "skip", answeredAt: string): Gate {
  if (gate.status !== "open") throw new Error("Gate already closed");
  if (answer === "skip") return { ...gate, status: "skipped", answeredAt };
  if (
    !answer ||
    (!answer.optionIds.length && !answer.note?.trim()) ||
    (!gate.multiSelect && answer.optionIds.length > 1) ||
    new Set(answer.optionIds).size !== answer.optionIds.length ||
    answer.optionIds.some((id) => !gate.options.some((o) => o.id === id))
  )
    throw new Error("Invalid gate answer");
  return { ...gate, status: "answered", answer, answeredAt };
}
