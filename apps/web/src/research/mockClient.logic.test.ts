import { expect, it } from "vite-plus/test";

import { WORLD_MODEL_PROJECT_ID } from "./fixtures/mockSeedData";
import { MockResearchClient } from "./mockClient";

it("links the seeded report's primary metric to the ledger run", async () => {
  const html = await new MockResearchClient().getReportHtml(WORLD_MODEL_PROJECT_ID);
  expect(html).toContain('data-run-id="run-a-15" data-metric-name="success_h32">0.776</a>');
  expect(html).toContain('id="run-run-a-15"');
});
