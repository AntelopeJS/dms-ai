/** A skill as the sidecar's catalog lists it. */
export interface SidecarSkill {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  tags: string[];
  provenance: string;
  body: string;
  source?: string;
  origin?: string;
  uses30d?: number;
  lastUsedAtMs?: number;
  lastConversationId?: string;
  isShadowed?: boolean;
  shadowedBy?: string;
}

/** The sidecar's catalog. */
export interface SidecarSkillCatalog {
  items: SidecarSkill[];
}

/** A skill as the Skills table and its card and drawer read it. */
export interface SkillRow {
  _id: string;
  name: string;
  description: string;
  icon?: string;
  category?: string;
  source: string;
  origin: string;
  tags: string[];
  uses30d: number;
  lastUsedAtMs?: number;
  lastUsedAt?: string;
  lastConversationId?: string;
  isShadowed: boolean;
  shadowedBy?: string;
  body: string;
  qualifiedName: string;
}
