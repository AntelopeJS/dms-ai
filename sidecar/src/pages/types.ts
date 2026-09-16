export interface PagesRegistryEntry {
  id: string;
  path: string;
  filepath?: string;
  moduleId: string;
}

export interface PageCandidate {
  pagePath: string;
  pageFilepath: string;
  distance: number;
}
