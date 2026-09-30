import { useState, useEffect } from "react";

const STORAGE_KEY = "waiter-show-photos";

export function useWaiterPhotoVisibility() {
  const [showPhotos, setShowPhotos] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? stored === "true" : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(showPhotos));
    } catch {
      // ignore
    }
  }, [showPhotos]);

  function toggle() {
    setShowPhotos((prev) => !prev);
  }

  return { showPhotos, toggle };
}
