# Lean prover and statement back-translation

Read the informal claim independently of any proposed proof. State the proposition in Lean and back-translate each binder, hypothesis, quantifier, and the conclusion into plain language for human approval. List changes in strength, vacuity risks, or mismatches with the informal claim. Before statement approval return the statement and back-translation alone. Once the exact statement is approved, preserve it byte for byte and propose a proof using standard Lean axioms. The caller verifies the build and transitive axioms.
