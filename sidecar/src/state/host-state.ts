import { UNKNOWN_PAGE_PATH } from "../constants/host-state.js";
import type { PageFilepathResolver } from "../pages/page-filepath.js";

export interface CurrentPage {
  path: string;
  filepath?: string;
  title?: string;
}

/** What the browser reports about the page it displays. */
export interface ReportedPage {
  path: string;
  title?: string;
}

export interface HostState {
  getCurrentPage(): CurrentPage;
  setCurrentPage(page: ReportedPage): Promise<void>;
}

/** Options of {@link createHostState}. */
export interface HostStateOptions {
  resolveFilepath?: PageFilepathResolver;
}

function buildUnknownPage(): CurrentPage {
  return { path: UNKNOWN_PAGE_PATH };
}

function withFilepath(
  page: CurrentPage,
  filepath: string | undefined,
): CurrentPage {
  return filepath === undefined ? page : { ...page, filepath };
}

/**
 * Holds the page the host displays. The browser reports its route and title;
 * the source file is resolved here from the route, and only applied while
 * that report is still the latest one.
 */
export function createHostState(options: HostStateOptions = {}): HostState {
  let currentPage: CurrentPage = buildUnknownPage();
  return {
    getCurrentPage: () => currentPage,
    setCurrentPage: async (page) => {
      const reported: CurrentPage = { ...page };
      currentPage = reported;
      if (options.resolveFilepath === undefined) return;
      const filepath = await options.resolveFilepath(page.path);
      if (currentPage !== reported) return;
      currentPage = withFilepath(reported, filepath);
    },
  };
}
