import { UNKNOWN_PAGE_PATH } from "../constants/host-state.js";

export interface CurrentPage {
  path: string;
  filepath?: string;
  title?: string;
}

export interface HostState {
  getCurrentPage(): CurrentPage;
  setCurrentPage(page: CurrentPage): void;
}

function buildUnknownPage(): CurrentPage {
  return { path: UNKNOWN_PAGE_PATH };
}

export function createHostState(): HostState {
  let currentPage: CurrentPage = buildUnknownPage();
  return {
    getCurrentPage: () => currentPage,
    setCurrentPage: (page) => {
      currentPage = page;
    },
  };
}
