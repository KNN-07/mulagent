import type { ApprovalMode, ResearchProjectId } from "@t3tools/contracts";
import { msg, T, useGT, useMessages } from "gt-react";
import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogAction,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

import { getResearchClient } from "./researchStore";

interface NewResearchProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated: (researchProjectId: ResearchProjectId) => void;
}

const WORKFLOW_PRESETS = [
  {
    value: "research.yaml",
    label: msg("research.yaml (full survey, ideas, fan-out, critic, report)"),
  },
  {
    value: "hillclimb.yaml",
    label: msg("hillclimb.yaml (fixed-budget autoresearch loop)"),
  },
  {
    value: "reproduce.yaml",
    label: msg("reproduce.yaml (paper baseline reproduction and audit)"),
  },
  {
    value: "survey.yaml",
    label: msg("survey.yaml (literature synthesis and taxonomy)"),
  },
  {
    value: "prove.yaml",
    label: msg("prove.yaml (Lean 4 formal verification loop)"),
  },
] as const;

const APPROVAL_OPTIONS: ReadonlyArray<{
  readonly value: ApprovalMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "ask-always",
    label: msg("Ask at every gate"),
    description: msg("Pause before specs, scale promotions, and every finding."),
  },
  {
    value: "ask-risky",
    label: msg("Ask for risky actions"),
    description: msg("Run toy and small rungs automatically; pause at budget and claim gates."),
  },
  {
    value: "autonomous",
    label: msg("Autonomous within budget"),
    description: msg("Execute until the budget cap or stop rule is reached, then deliver report."),
  },
];

function parsePositiveBudget(raw: string, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function NewResearchProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: NewResearchProjectDialogProps) {
  const gt = useGT();
  const m = useMessages();

  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [workflow, setWorkflow] = useState<string>("research.yaml");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask-risky");
  const [gpuHours, setGpuHours] = useState("40");
  const [usdBudget, setUsdBudget] = useState("150");
  const [llmUsdPerWeek, setLlmUsdPerWeek] = useState("45");
  const [submitting, setSubmitting] = useState(false);

  const selectedWorkflow =
    WORKFLOW_PRESETS.find((preset) => preset.value === workflow) ?? WORKFLOW_PRESETS[0];

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedGoal = goal.trim();
    if (!trimmedGoal || submitting) return;
    setSubmitting(true);
    const client = getResearchClient();
    const created = await client.startProject(
      trimmedGoal,
      workflow,
      approvalMode,
      {
        gpuHours: parsePositiveBudget(gpuHours, 40),
        usd: parsePositiveBudget(usdBudget, 150),
        llmUsdPerWeek: parsePositiveBudget(llmUsdPerWeek, 45),
      },
      title.trim() || undefined,
    );
    setSubmitting(false);
    setTitle("");
    setGoal("");
    onOpenChange(false);
    onCreated(created.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              <T>New research project</T>
            </DialogTitle>
            <DialogDescription>
              <T>
                Define the research goal, workflow DAG, approval policy, and compute budget caps.
              </T>
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-research-title">
                <T>Project slug (optional)</T>
              </Label>
              <Input
                id="new-research-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={gt("e.g. world-model-planning")}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-research-goal">
                <T>Research goal</T>
              </Label>
              <Textarea
                id="new-research-goal"
                rows={3}
                required
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder={gt(
                  "Describe the hypothesis, benchmark, baseline, or theorem to investigate",
                )}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-research-workflow">
                <T>Workflow preset</T>
              </Label>
              <Select
                value={workflow}
                onValueChange={(next) => {
                  if (typeof next === "string") setWorkflow(next);
                }}
              >
                <SelectTrigger id="new-research-workflow">
                  <SelectValue>{m(selectedWorkflow.label)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {WORKFLOW_PRESETS.map((preset) => (
                    <SelectItem key={preset.value} value={preset.value}>
                      {m(preset.label)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <fieldset className="flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium text-foreground">
                <T>Approval mode</T>
              </legend>
              <RadioGroup
                value={approvalMode}
                onValueChange={(next) => {
                  if (next === "ask-always" || next === "ask-risky" || next === "autonomous") {
                    setApprovalMode(next);
                  }
                }}
              >
                {APPROVAL_OPTIONS.map((option) => {
                  const id = `approval-mode-${option.value}`;
                  return (
                    <label
                      key={option.value}
                      htmlFor={id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5 hover:bg-accent/40"
                    >
                      <Radio id={id} value={option.value} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-foreground">{m(option.label)}</div>
                        <div className="text-xs text-muted-foreground">{m(option.description)}</div>
                      </div>
                    </label>
                  );
                })}
              </RadioGroup>
            </fieldset>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-research-gpu-hours">
                  <T>GPU-hours cap</T>
                </Label>
                <Input
                  id="new-research-gpu-hours"
                  type="number"
                  min={1}
                  step="1"
                  font="mono"
                  value={gpuHours}
                  onChange={(event) => setGpuHours(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-research-usd">
                  <T>Compute USD cap</T>
                </Label>
                <Input
                  id="new-research-usd"
                  type="number"
                  min={0}
                  step="5"
                  font="mono"
                  value={usdBudget}
                  onChange={(event) => setUsdBudget(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-research-llm-usd">
                  <T>LLM USD / week</T>
                </Label>
                <Input
                  id="new-research-llm-usd"
                  type="number"
                  min={1}
                  step="5"
                  font="mono"
                  value={llmUsdPerWeek}
                  onChange={(event) => setLlmUsdPerWeek(event.target.value)}
                />
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>
              <T>Cancel</T>
            </DialogClose>
            <DialogAction type="submit" disabled={submitting || goal.trim().length === 0}>
              <T>Start research loop</T>
            </DialogAction>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
