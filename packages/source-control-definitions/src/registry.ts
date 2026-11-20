import { makeSourceControlDefinitionRegistry } from "@t3tools/source-control-core/shared/definition";
import * as GitHub from "@t3tools/source-control-github/shared/definition";
import * as GitLab from "@t3tools/source-control-gitlab/shared/definition";

export const builtInSourceControlDefinitions = makeSourceControlDefinitionRegistry([
  GitHub.definition,
  GitLab.definition,
]);
