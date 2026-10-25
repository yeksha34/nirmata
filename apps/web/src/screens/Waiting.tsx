import { useApp } from "../app-context";
import { Panel } from "../ui";
import { People } from "./Board";

/**
 * What a player or spectator sees behind the story window: who is here while the host chooses a
 * story, and a pointer to the window once one is open.
 */
export function Waiting() {
  const { state } = useApp();
  const host = state.board?.host ?? "The host";
  if (state.story) {
    return (
      <div className="waiting">
        <Panel title={state.world?.title ?? "The story"}>
          <p className="lead">The story is open in the window.</p>
          <p className="muted">
            Drag it by its title bar to put it where you like, or minimize it to a chip in the
            corner and open it again from there.
          </p>
        </Panel>
      </div>
    );
  }
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
