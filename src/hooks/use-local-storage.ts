"use client";

import { useEffect, useState } from "react";

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [storedValue, setStoredValue] = useState<T>(initialValue);

  useEffect(() => {
    const readStoredValue = () => {
      try {
        const item = window.localStorage.getItem(key);
        if (item !== null) setStoredValue(JSON.parse(item) as T);
      } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
    };
    const timer = window.setTimeout(readStoredValue, 0);
    return () => window.clearTimeout(timer);
  }, [key]);

  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(key, JSON.stringify(valueToStore));
      }
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  };

  return [storedValue, setValue];
}
