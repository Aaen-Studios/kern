/**
 * File search hook for the file editor.
 *
 * Searches across the instance's working directory for files matching a query.
 * Supports both filename-only and content search modes. Results include line
 * numbers and previews for content matches, enabling quick navigation.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  relPath: string;
  lineNumber: number | null;
  linePreview: string | null;
}

export interface FileSearchState {
  /** Search results, grouped by file path. */
  results: SearchMatch[];
  /** Whether a search is in progress. */
  searching: boolean;
  /** Error message from the last search. */
  error: string | null;
}

export interface FileSearchActions {
  /** Execute a search with the given query and mode. */
  search: (query: string, mode: "filenames" | "contents", include?: string, exclude?: string) => Promise<void>;
  /** Clear all search results. */
  clear: () => void;
}

/**
 * Hook for searching files across a server instance.
 * Uses the backend search_files command with debounced results.
 */
export function useFileSearch(serverId: string): FileSearchState & FileSearchActions {
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string, mode: "filenames" | "contents", include?: string, exclude?: string) => {
    if (!query.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const matches = await invoke<SearchMatch[]>("search_files", {
        id: serverId,
        query,
        mode,
        include: include || undefined,
        exclude: exclude || undefined,
      });
      setResults(matches);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [serverId]);

  const clear = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    results,
    searching,
    error,
    search,
    clear,
  };
}