import { useState } from "react";
import { OPENAPI_KEY_STORAGE_KEY } from "../constants";

export function useOpenApiKey(onReset: () => void) {
  const [openApiKey, setOpenApiKey] = useState(() => {
    try {
      return window.localStorage.getItem(OPENAPI_KEY_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const openApiKeyForRequests = openApiKey;
  const hasOpenApiKey = !!openApiKeyForRequests.trim();

  const handleOpenApiKeyChange = (value: string) => {
    setOpenApiKey(value);
    try {
      const token = value.trim();
      if (token) {
        window.localStorage.setItem(OPENAPI_KEY_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(OPENAPI_KEY_STORAGE_KEY);
      }
    } catch {
      // localStorage is only a convenience; requests still use React state.
    }
    onReset();
  };

  return {
    openApiKey,
    openApiKeyForRequests,
    hasOpenApiKey,
    handleOpenApiKeyChange,
  };
}
