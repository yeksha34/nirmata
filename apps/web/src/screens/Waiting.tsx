import { useApp } from "../app-context";
import { Panel } from "../ui";
import { People } from "./Board";

/** What a player or spectator sees until the host has chosen a world and started a story. */
export function Waiting() {
  const { state } = useApp();
  const host = state.board?.host ?? "The host";
  return (
    <div className="waiting">
      <Panel title={state.world ? state.world.title : "Waiting for the host"}>
        <p className="lead">
          {state.world
            ? `${host} is choosing a story. It will appear here the moment it begins.`
            : `${host} hasn't chosen a world yet. You're in; this will fill in on its own.`}
        </p>
        {state.world?.tagline && <p className="muted">{state.world.tagline}</p>}
      </Panel>
      <People />
    </div>
  );
}
