import { reportMutationError } from "./researchStore";
import { useCanOperateResearch } from "./rpcClient";
import type { Gate } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Radio, RadioGroup } from "~/components/ui/radio-group";

interface DecisionQuestionCardProps {
  readonly gate: Gate;
  readonly onAnswer: (optionIds: ReadonlyArray<string>, note?: string) => Promise<void>;
  readonly onSkip: () => Promise<void>;
}

function initialSelectedIds(gate: Gate): ReadonlyArray<string> {
  if (gate.answer && gate.answer.optionIds.length > 0) return gate.answer.optionIds;
  const recommended = gate.options.find((option) => option.recommended);
  if (recommended) return [recommended.id];
  const first = gate.options[0];
  return first ? [first.id] : [];
}

export function DecisionQuestionCard({ gate, onAnswer, onSkip }: DecisionQuestionCardProps) {
  const gt = useGT();
  const canOperate = useCanOperateResearch();
  const [selectedIds, setSelectedIds] = useState<ReadonlyArray<string>>(() =>
    initialSelectedIds(gate),
  );
  const [note, setNote] = useState(gate.answer?.note ?? "");
  const [submitting, setSubmitting] = useState(false);

  const headingId = `research-gate-${gate.id}`;
  const noteInputId = `research-gate-note-${gate.id}`;

  const toggleMultiOption = (optionId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        return prev.includes(optionId) ? prev : [...prev, optionId];
      }
      return prev.filter((id) => id !== optionId);
    });
  };

  const handleContinue = async () => {
    if (!canOperate || selectedIds.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(selectedIds, note.trim() || undefined);
    } catch (error) {
      reportMutationError(error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = async () => {
    if (!canOperate || submitting) return;
    setSubmitting(true);
    try {
      await onSkip();
    } catch (error) {
      reportMutationError(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (gate.status !== "open") {
    const selectedLabels = gate.options
      .filter((option) => gate.answer?.optionIds.includes(option.id))
      .map((option) => option.label)
      .join(", ");

    return (
      <section
        aria-labelledby={headingId}
        className="rounded-xl border border-border bg-card p-4 text-sm"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              <T>Decision recorded</T>
            </p>
            <h2 id={headingId} className="mt-0.5 font-medium text-foreground">
              {gate.title}
            </h2>
          </div>
          <Badge size="sm" variant={gate.status === "answered" ? "success" : "secondary"}>
            {gate.status === "answered" ? <T>Answered</T> : <T>Skipped</T>}
          </Badge>
        </div>
        {selectedLabels ? (
          <p className="mt-2 text-xs text-muted-foreground">
            <T>
              Selected: <Var>{selectedLabels}</Var>
            </T>
          </p>
        ) : null}
        {gate.answer?.note ? (
          <p className="mt-1 text-xs text-muted-foreground">
            <T>
              Note: <Var>{gate.answer.note}</Var>
            </T>
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-card p-4 text-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          <T>Question</T>
        </span>
        {gate.multiSelect ? (
          <Badge size="sm" variant="outline">
            <T>Select one or more</T>
          </Badge>
        ) : null}
      </div>
      <h2 id={headingId} className="mt-1 font-medium text-foreground">
        {gate.title}
      </h2>
      {gate.body ? <p className="mt-1 text-xs text-muted-foreground">{gate.body}</p> : null}

      <fieldset className="mt-3 flex flex-col gap-1 border-0 p-0">
        <legend className="sr-only">{gate.title}</legend>
        {gate.multiSelect ? (
          gate.options.map((option) => {
            const checked = selectedIds.includes(option.id);
            const controlId = `${headingId}-${option.id}`;
            return (
              <label
                key={option.id}
                htmlFor={controlId}
                className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-accent/50"
              >
                <Checkbox
                  id={controlId}
                  checked={checked}
                  onCheckedChange={(next) => toggleMultiOption(option.id, next === true)}
                />
                <span className="min-w-0 flex-1">{option.label}</span>
                {option.recommended ? (
                  <Badge size="sm" variant="secondary">
                    <T>recommended</T>
                  </Badge>
                ) : null}
              </label>
            );
          })
        ) : (
          <RadioGroup
            value={selectedIds[0] ?? ""}
            onValueChange={(value) => {
              if (typeof value === "string" && value.length > 0) {
                setSelectedIds([value]);
              }
            }}
          >
            {gate.options.map((option) => {
              const controlId = `${headingId}-${option.id}`;
              return (
                <label
                  key={option.id}
                  htmlFor={controlId}
                  className="flex min-h-9 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-accent/50"
                >
                  <Radio id={controlId} value={option.id} />
                  <span className="min-w-0 flex-1">{option.label}</span>
                  {option.recommended ? (
                    <Badge size="sm" variant="secondary">
                      <T>recommended</T>
                    </Badge>
                  ) : null}
                </label>
              );
            })}
          </RadioGroup>
        )}
      </fieldset>

      <div className="mt-3 flex flex-col gap-1.5">
        <Label htmlFor={noteInputId} className="sr-only">
          <T>Optional note for the agent</T>
        </Label>
        <Input
          id={noteInputId}
          size="sm"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={gt("Optional note or constraint")}
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={!canOperate || submitting}
          onClick={handleSkip}
        >
          <T>Skip</T>
        </Button>
        <Button
          size="sm"
          variant="default"
          disabled={!canOperate || submitting || selectedIds.length === 0}
          onClick={handleContinue}
        >
          <T>Continue</T>
        </Button>
      </div>
    </section>
  );
}
