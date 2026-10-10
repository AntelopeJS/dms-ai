import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types";
import type { FormSection } from "@antelopejs/interface-dms/base/form-types";
import { SETTINGS_SKILLS_SECTION } from "../../constants/pages";
import {
  MODE_OPTIONS,
  PROVIDER_OPTIONS,
  REQUEST_TIMEOUT_OPTIONS,
  RETENTION_OPTIONS,
  SCOPE_OPTIONS,
  settingsText,
  THINKING_OPTIONS,
} from "./options";

const NEXT_TURN_HINT = settingsText("hints", "next_turn");
const NEXT_MESSAGE_HINT = settingsText("hints", "next_message");
const NEW_CONVERSATIONS_HINT = settingsText("hints", "new_conversations");

function switchType(field: string) {
  return new DefaultDataTypes.BooleanType({
    label: settingsText(field, "label"),
    description: settingsText(field, "description"),
  });
}

const AGENT: FormSection = {
  id: "agent",
  label: settingsText("sections", "agent", "label"),
  description: settingsText("sections", "agent", "description"),
  icon: "i-ph-robot",
  fields: [
    {
      id: "provider",
      label: settingsText("provider", "label"),
      description: settingsText("provider", "description"),
      hint: NEXT_TURN_HINT,
      type: new DefaultDataTypes.SelectType({
        display: "cards",
        items: PROVIDER_OPTIONS,
      }),
      required: true,
    },
    {
      id: "thinking",
      label: settingsText("thinking", "label"),
      description: settingsText("thinking", "description"),
      hint: NEXT_MESSAGE_HINT,
      type: new DefaultDataTypes.SelectType({
        display: "segmented",
        items: THINKING_OPTIONS,
      }),
      required: true,
    },
  ],
};

const APPROVALS: FormSection = {
  id: "approvals",
  label: settingsText("sections", "approvals", "label"),
  description: settingsText("sections", "approvals", "description"),
  icon: "i-ph-hand-palm",
  fields: [
    {
      id: "mode",
      label: settingsText("mode", "label"),
      description: settingsText("mode", "description"),
      hint: NEW_CONVERSATIONS_HINT,
      type: new DefaultDataTypes.SelectType({
        display: "cards",
        items: MODE_OPTIONS,
      }),
      required: true,
    },
    {
      id: "alwaysAsk",
      label: settingsText("always_ask", "label"),
      description: settingsText("always_ask", "description"),
      orientation: "vertical",
      fields: [
        {
          id: "alwaysAskDeletions",
          label: settingsText("always_ask_deletions", "label"),
          type: switchType("always_ask_deletions"),
          readonly: {
            badge: {
              label: settingsText("always_ask_deletions", "locked"),
              tone: "neutral",
            },
          },
        },
        {
          id: "alwaysAskDependencies",
          type: switchType("always_ask_dependencies"),
        },
        {
          id: "alwaysAskBlockRemoval",
          type: switchType("always_ask_block_removal"),
        },
      ],
    },
    {
      id: "unanswered",
      label: settingsText("unanswered", "label"),
      description: settingsText("unanswered", "description"),
      orientation: "vertical",
      fields: [
        {
          id: "requestTimeoutMinutes",
          label: settingsText("request_timeout", "label"),
          type: new DefaultDataTypes.SelectType({
            items: REQUEST_TIMEOUT_OPTIONS,
          }),
          required: true,
        },
        { id: "notifyRequests", type: switchType("notify_requests") },
      ],
    },
  ],
};

const SCOPE: FormSection = {
  id: "scope",
  label: settingsText("sections", "scope", "label"),
  description: settingsText("sections", "scope", "description"),
  icon: "i-ph-shield-check",
  fields: [
    {
      id: "generationMode",
      label: settingsText("generation_mode", "label"),
      description: settingsText("generation_mode", "description"),
      hint: NEW_CONVERSATIONS_HINT,
      type: new DefaultDataTypes.SelectType({
        display: "cards",
        items: SCOPE_OPTIONS,
      }),
      required: true,
    },
  ],
};

const SKILLS: FormSection = {
  id: SETTINGS_SKILLS_SECTION,
  label: settingsText("sections", "skills", "label"),
  description: settingsText("sections", "skills", "description"),
  icon: "i-ph-books",
  fields: [
    {
      id: "allowLocalSkills",
      label: settingsText("allow_local_skills", "title"),
      hint: NEW_CONVERSATIONS_HINT,
      type: switchType("allow_local_skills"),
    },
  ],
};

const HISTORY: FormSection = {
  id: "history",
  label: settingsText("sections", "history", "label"),
  description: settingsText("sections", "history", "description"),
  icon: "i-ph-clock-counter-clockwise",
  fields: [
    {
      id: "checkpointRetentionDays",
      label: settingsText("checkpoint_retention", "label"),
      description: settingsText("checkpoint_retention", "description"),
      type: new DefaultDataTypes.SelectType({ items: RETENTION_OPTIONS }),
      required: true,
    },
  ],
};

/** The settings form's sections, in the mockup's order. */
export const SETTINGS_SECTIONS: FormSection[] = [
  AGENT,
  APPROVALS,
  SCOPE,
  SKILLS,
  HISTORY,
];
