import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAct } from "../app-context";
import { bilingual, T } from "../i18n";
import type { SceneCardAssignment, SceneMatrixRow } from "../types";

export interface ScopeProps {
  type: "chapter" | "vn";
  world: string;
  scopeSlug: string; // chapter slug or vn slug
}

export interface CardOption {
  id: string;
  slug?: string;
  name: string;
  kind: string;
  summary?: string;
}

const CHARACTER_STATES = ["base", "naked", "disguised", "transformed", "custom"];
const CLOTHING_STATES = ["intact", "torn", "altered", "soiled", "discarded"];

export function SceneMatrixView({
  scope,
  title,
  suggestedScenes,
}: {
  scope: ScopeProps;
  title?: string;
  suggestedScenes?: string[];
}) {
  const { act, busy } = useAct();
  const [matrix, setMatrix] = useState<SceneMatrixRow[]>([]);
  const [cards, setCards] = useState<CardOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [newSceneId, setNewSceneId] = useState("");
  const [addingToScene, setAddingToScene] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState("");
  const [selectedCharState, setSelectedCharState] = useState("base");
  const [selectedClothingState, setSelectedClothingState] = useState("intact");
  const [selectedRole, setSelectedRole] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (scope.type === "chapter") {
        const [m, c] = await Promise.all([
          api.chapterSceneMatrix(scope.world, scope.scopeSlug),
          api.chapterCards(scope.world, scope.scopeSlug),
        ]);
        setMatrix(m ?? []);
        setCards(c ?? []);
      } else {
        const [m, c] = await Promise.all([
          api.vnSceneMatrix(scope.world, scope.scopeSlug),
          api.vnCards(scope.world, scope.scopeSlug),
        ]);
        setMatrix(m ?? []);
        setCards(c ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [scope.type, scope.world, scope.scopeSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Combine matrix scenes with suggested scenes
  const allSceneIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of matrix) set.add(r.sceneId);
    if (suggestedScenes) {
      for (const s of suggestedScenes) set.add(s);
    }
    return Array.from(set).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }, [matrix, suggestedScenes]);

  const filteredSceneIds = useMemo(() => {
    if (!filterQuery.trim()) return allSceneIds;
    const q = filterQuery.toLowerCase();
    return allSceneIds.filter((sid) => {
      if (sid.toLowerCase().includes(q)) return true;
      const row = matrix.find((r) => r.sceneId === sid);
      return row?.cards.some(
        (a: SceneCardAssignment) =>
          a.cardSlug?.toLowerCase().includes(q) ||
          a.cardKind?.toLowerCase().includes(q) ||
          a.characterState?.toLowerCase().includes(q) ||
          a.clothingState?.toLowerCase().includes(q) ||
          a.role?.toLowerCase().includes(q),
      );
    });
  }, [allSceneIds, filterQuery, matrix]);

  const handleSaveState = async (
    sceneId: string,
    cardId: string,
    charState?: string,
    clothState?: string,
    role?: string,
  ) => {
    await act(async () => {
      if (scope.type === "chapter") {
        await api.saveChapterSceneCard(scope.world, scope.scopeSlug, sceneId, {
          cardId,
          characterState: charState,
          clothingState: clothState,
          role,
        });
      } else {
        await api.saveVnSceneCard(scope.world, scope.scopeSlug, sceneId, {
          cardId,
          characterState: charState,
          clothingState: clothState,
          role,
        });
      }
      await load();
    });
  };

  const handleRemoveAssignment = async (sceneId: string, cardId: string) => {
    await act(async () => {
      if (scope.type === "chapter") {
        await api.removeChapterSceneCard(scope.world, scope.scopeSlug, sceneId, cardId);
      } else {
        await api.removeVnSceneCard(scope.world, scope.scopeSlug, sceneId, cardId);
      }
      await load();
    });
  };

  const handleAddAssignment = async (sceneId: string) => {
    if (!selectedCardId) return;
    const card = cards.find((c) => c.id === selectedCardId);
    const isChar = card?.kind === "character";
    const isAttire = card?.kind === "attire" || card?.kind === "clothes";

    await handleSaveState(
      sceneId,
      selectedCardId,
      isChar ? selectedCharState : undefined,
      isAttire ? selectedClothingState : undefined,
      selectedRole.trim() || undefined,
    );

    setAddingToScene(null);
    setSelectedCardId("");
    setSelectedRole("");
  };

  return (
    <section className="scene-matrix-panel" aria-label="Scene State Matrix">
      <header className="matrix-header">
        <hgroup className="matrix-title-group">
          <h3>
            <T>Scene State Matrix</T>
          </h3>
          {title && <small className="muted">· {title}</small>}
        </hgroup>
        <menu className="matrix-controls">
          <li>
            <input
              type="search"
              placeholder={bilingual("Filter scenes or cards…")}
              aria-label="Filter scenes"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </li>
          <li>
            <form
              className="add-scene-form"
              onSubmit={(e) => {
                e.preventDefault();
                const s = newSceneId.trim();
                if (s && !allSceneIds.includes(s)) {
                  setAddingToScene(s);
                  setNewSceneId("");
                }
              }}
            >
              <input
                type="text"
                placeholder={bilingual("New scene id (e.g. scene_01)")}
                aria-label="New scene id"
                value={newSceneId}
                onChange={(e) => setNewSceneId(e.target.value)}
              />
              <button type="submit" disabled={!newSceneId.trim() || busy}>
                <T>Add Scene</T>
              </button>
            </form>
          </li>
        </menu>
      </header>

      {loading ? (
        <p className="muted">
          <T>Loading scene matrix…</T>
        </p>
      ) : filteredSceneIds.length === 0 ? (
        <p className="empty">
          <T>No scenes found. Add a scene above or adjust filters.</T>
        </p>
      ) : (
        <figure className="matrix-table-wrap">
          <table className="matrix-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: "12%" }}>
                  <T>Scene</T>
                </th>
                <th scope="col" style={{ width: "24%" }}>
                  <T>Characters & States</T>
                </th>
                <th scope="col" style={{ width: "24%" }}>
                  <T>Attire & Clothes</T>
                </th>
                <th scope="col" style={{ width: "18%" }}>
                  <T>Accessories & Adornments</T>
                </th>
                <th scope="col" style={{ width: "14%" }}>
                  <T>Objects & Relics</T>
                </th>
                <th scope="col" style={{ width: "8%" }}>
                  <T>Actions</T>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSceneIds.map((sid) => {
                const row = matrix.find((r) => r.sceneId === sid);
                const assignedCards: SceneCardAssignment[] = row?.cards ?? [];

                const chars = assignedCards.filter((a) => a.cardKind === "character");
                const clothes = assignedCards.filter(
                  (a) => a.cardKind === "attire" || a.cardKind === "clothes",
                );
                const accessories = assignedCards.filter(
                  (a) => a.cardKind === "accessory" || a.cardKind === "adornment",
                );
                const objects = assignedCards.filter((a) => a.cardKind === "object");

                return (
                  <tr key={sid}>
                    <th scope="row" className="scene-id-cell">
                      <code>{sid}</code>
                    </th>

                    {/* Characters */}
                    <td className="matrix-cell">
                      <ul className="cell-items">
                        {chars.map((c: SceneCardAssignment) => (
                          <li key={c.cardId || c.cardSlug} className="state-badge-item char-badge">
                            <strong className="item-name">{c.cardName || c.cardSlug}</strong>
                            <select
                              aria-label={`State of ${c.cardSlug}`}
                              value={c.characterState || "base"}
                              disabled={busy}
                              onChange={(e) => {
                                void handleSaveState(
                                  sid,
                                  c.cardId,
                                  e.target.value,
                                  undefined,
                                  c.role,
                                );
                              }}
                            >
                              {CHARACTER_STATES.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="remove-btn"
                              title={bilingual("Remove")}
                              disabled={busy}
                              onClick={() => {
                                void handleRemoveAssignment(sid, c.cardId);
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>

                    {/* Attire & Clothes */}
                    <td className="matrix-cell">
                      <ul className="cell-items">
                        {clothes.map((cl: SceneCardAssignment) => (
                          <li key={cl.cardId || cl.cardSlug} className="state-badge-item attire-badge">
                            <strong className="item-name">{cl.cardName || cl.cardSlug}</strong>
                            {cl.role && <small className="state-of">({cl.role})</small>}
                            <select
                              aria-label={`Clothing state of ${cl.cardSlug}`}
                              value={cl.clothingState || "intact"}
                              disabled={busy}
                              onChange={(e) => {
                                void handleSaveState(
                                  sid,
                                  cl.cardId,
                                  undefined,
                                  e.target.value,
                                  cl.role,
                                );
                              }}
                            >
                              {CLOTHING_STATES.map((st) => (
                                <option key={st} value={st}>
                                  {st}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="remove-btn"
                              title={bilingual("Remove")}
                              disabled={busy}
                              onClick={() => {
                                void handleRemoveAssignment(sid, cl.cardId);
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>

                    {/* Accessories */}
                    <td className="matrix-cell">
                      <ul className="cell-items">
                        {accessories.map((ac: SceneCardAssignment) => (
                          <li key={ac.cardId || ac.cardSlug} className="state-badge-item acc-badge">
                            <strong className="item-name">{ac.cardName || ac.cardSlug}</strong>
                            {ac.role && <small className="state-of">({ac.role})</small>}
                            <button
                              type="button"
                              className="remove-btn"
                              title={bilingual("Remove")}
                              disabled={busy}
                              onClick={() => {
                                void handleRemoveAssignment(sid, ac.cardId);
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>

                    {/* Objects */}
                    <td className="matrix-cell">
                      <ul className="cell-items">
                        {objects.map((ob: SceneCardAssignment) => (
                          <li key={ob.cardId || ob.cardSlug} className="state-badge-item obj-badge">
                            <strong className="item-name">{ob.cardName || ob.cardSlug}</strong>
                            <button
                              type="button"
                              className="remove-btn"
                              title={bilingual("Remove")}
                              disabled={busy}
                              onClick={() => {
                                void handleRemoveAssignment(sid, ob.cardId);
                              }}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                      </ul>
                    </td>

                    {/* Actions */}
                    <td className="matrix-cell action-cell">
                      <button
                        type="button"
                        className="crumb-link"
                        onClick={() => {
                          setAddingToScene(sid);
                          setSelectedCardId(cards[0]?.id || "");
                        }}
                      >
                        + <T>Card</T>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </figure>
      )}

      {/* Add Assignment Modal / Dialog */}
      {addingToScene && (
        <dialog
          className="matrix-assign-modal"
          open
          aria-labelledby="assign-modal-title"
        >
          <h4 id="assign-modal-title">
            <T with={{ scene: addingToScene }}>{"Assign Card to Scene: {scene}"}</T>
          </h4>
          <fieldset className="form-fields">
            <label>
              <small>
                <T>Card</T>
              </small>
              <select
                value={selectedCardId}
                onChange={(e) => setSelectedCardId(e.target.value)}
              >
                <option value="">{bilingual("Select a card…")}</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    [{c.kind}] {c.name} ({c.slug || c.id})
                  </option>
                ))}
              </select>
            </label>

            {cards.find((c) => c.id === selectedCardId)?.kind === "character" && (
              <label>
                <small>
                  <T>Character State</T>
                </small>
                <select
                  value={selectedCharState}
                  onChange={(e) => setSelectedCharState(e.target.value)}
                >
                  {CHARACTER_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {(cards.find((c) => c.id === selectedCardId)?.kind === "attire" ||
              cards.find((c) => c.id === selectedCardId)?.kind === "clothes") && (
              <>
                <label>
                  <small>
                    <T>Clothing State</T>
                  </small>
                  <select
                    value={selectedClothingState}
                    onChange={(e) => setSelectedClothingState(e.target.value)}
                  >
                    {CLOTHING_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <small>
                    <T>Worn by (Character)</T>
                  </small>
                  <input
                    type="text"
                    placeholder={bilingual("Character name or slug")}
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                  />
                </label>
              </>
            )}

            {(cards.find((c) => c.id === selectedCardId)?.kind === "accessory" ||
              cards.find((c) => c.id === selectedCardId)?.kind === "adornment") && (
              <label>
                <small>
                  <T>Equipped on (Character)</T>
                </small>
                <input
                  type="text"
                  placeholder={bilingual("Character name or slug")}
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value)}
                />
              </label>
            )}
          </fieldset>

          <menu className="modal-actions">
            <li>
              <button
                type="button"
                className="primary"
                disabled={!selectedCardId || busy}
                onClick={() => handleAddAssignment(addingToScene)}
              >
                <T>Assign</T>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => setAddingToScene(null)}>
                <T>Cancel</T>
              </button>
            </li>
          </menu>
        </dialog>
      )}
    </section>
  );
}
