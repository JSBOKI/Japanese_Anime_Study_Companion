import { createContext, useContext } from "react";

export type SessionState = {
  required: boolean;
  signOut: () => Promise<void>;
};

export const SessionContext = createContext<SessionState>({
  required: false,
  signOut: async () => undefined,
});

export function useSession(): SessionState {
  return useContext(SessionContext);
}
