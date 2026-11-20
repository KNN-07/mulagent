import { issueTrackerSummary } from "@t3tools/client-runtime/state/issue-trackers";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  IssueTrackerConnection,
  IssueTrackerConnectionList,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useNavigation } from "@react-navigation/native";
import { useGT, useMessages } from "gt-react-native";
import { useState } from "react";
import { Platform, View } from "react-native";
import { tryOpenExternalUrl } from "../../../lib/openExternalUrl";

import { SymbolView } from "../../../components/ui/AppSymbol";
import { AppText as Text } from "../../../components/ui/AppText";
import { Button } from "../../../components/ui/Button";
import { Menu } from "../../../components/ui/Menu";
import { SecretTextInput } from "../../../components/ui/SecretTextInput";
import { useProjects } from "../../../state/entities";
import { issueTrackerEnvironment } from "../../../state/issueTrackers";
import { useEnvironmentQuery } from "../../../state/query";
import { useAtomCommand } from "../../../state/use-atom-command";
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsProviderRow } from "./SettingsProviderRow";
import { SettingsRow } from "./SettingsRow";
import { SettingsSection } from "./SettingsSection";

const UNBOUND = "";
const ICON_SIZE = Platform.OS === "android" ? 20 : 18;

/**
 * Standalone issue trackers for each selected environment: connect one with a
 * credential, then pick which of its scopes each project lists beside its repository's issues.
 */
export function IssueTrackerSection(props: { readonly environments: readonly SettingsTarget[] }) {
  const gt = useGT();
  return (
    <>
      {props.environments.map((environment) =>
        environment.serverConfig.environment.capabilities.issues === true ? (
          <EnvironmentTrackers
            key={environment.environmentId}
            environment={environment}
            title={
              props.environments.length > 1
                ? gt("Issue trackers · {environment}", { environment: environment.label })
                : gt("Issue trackers")
            }
          />
        ) : null,
      )}
    </>
  );
}

function EnvironmentTrackers(props: {
  readonly environment: SettingsTarget;
  readonly title: string;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigation = useNavigation();
  const { environmentId } = props.environment;
  const query = useEnvironmentQuery(
    issueTrackerEnvironment.connections({ environmentId, input: {} }),
  );
  const trackers = query.data?.trackers ?? [];
  if (trackers.length === 0) {
    return query.error ? (
      <SettingsSection title={props.title} footer={query.error}>
        <View className="p-4">
          <Button label={gt("Try again")} tone="secondary" onPress={query.refresh} />
        </View>
      </SettingsSection>
    ) : null;
  }
  return (
    <SettingsSection title={props.title}>
      {trackers.map((tracker, index) => (
        <SettingsProviderRow
          key={tracker.tracker}
          icon={<IssueTrackerMark />}
          label={tracker.displayName}
          description={issueTrackerSummary(tracker, query.data?.bindings ?? {}, messages)}
          ready={tracker.connected && tracker.account !== null}
          separated={index > 0}
          onPress={() =>
            navigation.navigate("SettingsIssueTracker", {
              environmentId,
              tracker: tracker.tracker,
            })
          }
        />
      ))}
    </SettingsSection>
  );
}

export function IssueTrackerMark() {
  return <SymbolView name="circle.dashed" size={ICON_SIZE} tintColorClassName="accent-icon" />;
}

/** The credential field for one tracker, with what replaces, removes or creates it. */
export function IssueTrackerCredentialForm(props: {
  readonly environmentId: EnvironmentId;
  readonly tracker: IssueTrackerConnection;
  readonly disabled: boolean;
}) {
  const gt = useGT();
  const { environmentId, tracker } = props;
  const connect = useAtomCommand(issueTrackerEnvironment.connect, { reportFailure: false });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (token: string | null) => {
    setBusy(true);
    setFailure(null);
    const result = await connect({ environmentId, input: { tracker: tracker.tracker, token } });
    setBusy(false);
    if (!AsyncResult.isFailure(result)) {
      setDraft("");
      return;
    }
    const error = squashAtomCommandFailure(result);
    setFailure(error instanceof Error ? error.message : gt("The request failed."));
  };
  const helpUrl = tracker.credential.helpUrl;
  const locked = props.disabled || busy;
  return (
    <View className="gap-3 p-4">
      <SecretTextInput
        accessibilityLabel={tracker.credential.label}
        placeholder={
          tracker.connected
            ? gt("Saved. Enter a new value to replace it")
            : tracker.credential.label
        }
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={(value) => {
          if (value.trim()) void submit(value.trim());
        }}
        editable={!locked}
      />
      {failure ? (
        <Text selectable className="text-xs text-danger-foreground">
          {failure}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap justify-end gap-2">
        {helpUrl ? (
          <Button
            label={gt("Create one")}
            tone="text"
            size="compact"
            onPress={() => void tryOpenExternalUrl(helpUrl)}
          />
        ) : null}
        {tracker.connected ? (
          <Button
            label={gt("Disconnect")}
            tone="secondary"
            size="compact"
            disabled={locked}
            onPress={() => void submit(null)}
          />
        ) : null}
        <Button
          label={
            tracker.connected
              ? gt("Replace", { $context: "verb, replaces a saved credential" })
              : gt("Connect", { $context: "verb, connects an issue tracker" })
          }
          tone="primary"
          size="compact"
          loading={busy}
          disabled={locked || !draft.trim()}
          onPress={() => void submit(draft.trim())}
        />
      </View>
    </View>
  );
}

/** One row per project of the environment: which of the tracker's scopes it reads, if any. */
export function IssueTrackerProjectRows(props: {
  readonly environmentId: EnvironmentId;
  readonly tracker: IssueTrackerConnection;
  readonly bindings: IssueTrackerConnectionList["bindings"];
  readonly disabled: boolean;
}) {
  const gt = useGT();
  const { environmentId, tracker } = props;
  const bind = useAtomCommand(issueTrackerEnvironment.bindProject, {
    label: `bind project to ${tracker.displayName}`,
  });
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [binding, setBinding] = useState<ProjectId | null>(null);
  const change = async (projectId: ProjectId, scope: string) => {
    if (props.disabled || binding !== null) return;
    setBinding(projectId);
    await bind({
      environmentId,
      input: {
        projectId,
        binding: scope === UNBOUND ? null : { tracker: tracker.tracker, scope },
      },
    });
    setBinding(null);
  };
  return projects.map((project) => {
    const bound = props.bindings[project.id];
    // A project bound to another tracker keeps that binding; this row shows it unbound.
    const value = bound?.tracker === tracker.tracker ? bound.scope : UNBOUND;
    const locked = props.disabled || binding !== null;
    return (
      <Menu
        key={project.id}
        title={gt("{tracker} {scope} for {project}", {
          tracker: tracker.displayName,
          scope: tracker.scopeNoun,
          project: project.title,
        })}
        actions={[
          {
            id: UNBOUND,
            title: gt("Not bound"),
            state: value === UNBOUND ? "on" : "off",
            attributes: { disabled: locked },
          },
          ...tracker.scopes.map((scope) => ({
            id: scope.key,
            title: `${scope.name} (${scope.key})`,
            state: scope.key === value ? ("on" as const) : ("off" as const),
            attributes: { disabled: locked },
          })),
        ]}
        onPressAction={({ nativeEvent }) => void change(project.id, nativeEvent.event)}
      >
        <SettingsRow
          icon="folder"
          label={project.title}
          valuePosition="trailing"
          value={
            value === UNBOUND
              ? gt("Not bound")
              : (tracker.scopes.find((scope) => scope.key === value)?.name ?? value)
          }
          disabled={locked}
        />
      </Menu>
    );
  });
}
