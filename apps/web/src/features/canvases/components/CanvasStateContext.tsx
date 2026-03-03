"use client";

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from "react";

interface CanvasStateContextType {
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  saveNow: () => void;
  registerSaveFunction: (fn: () => void) => void;
}

const CanvasStateContext = createContext<CanvasStateContextType | undefined>(
  undefined,
);

export function CanvasStateProvider({ children }: { children: ReactNode }) {
  const [isSaving, setIsSaving] = useState(false);
  const saveFunctionRef = useRef<(() => void) | null>(null);

  const registerSaveFunction = useCallback((fn: () => void) => {
    saveFunctionRef.current = fn;
  }, []);

  const saveNow = useCallback(() => {
    if (saveFunctionRef.current) {
      saveFunctionRef.current();
    }
  }, []);

  return (
    <CanvasStateContext.Provider
      value={{ isSaving, setIsSaving, saveNow, registerSaveFunction }}
    >
      {children}
    </CanvasStateContext.Provider>
  );
}

export function useCanvasState() {
  const context = useContext(CanvasStateContext);
  if (!context) {
    throw new Error("useCanvasState must be used within CanvasStateProvider");
  }
  return context;
}
