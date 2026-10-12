export type WorkspaceState = { open: boolean; view: "task" | "settings" };
export type WorkspaceAction =
  | { type: "task"; sameMode: boolean }
  | { type: "settings" }
  | { type: "show-settings" }
  | { type: "back" }
  | { type: "close" };

/** Visibility only; task state and running jobs belong to the existing controller. */
export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "task":
      return {
        view: "task",
        open: state.view === "task" && action.sameMode ? !state.open : true,
      };
    case "settings":
      return {
        view: "settings",
        open: state.view === "settings" ? !state.open : true,
      };
    case "show-settings":
      return { view: "settings", open: true };
    case "back":
      return { view: "task", open: true };
    case "close":
      return { ...state, open: false };
  }
}
