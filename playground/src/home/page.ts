import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Form } from "@antelopejs/interface-dms/base/form-schema";
import { NavCardGrid } from "@antelopejs/interface-dms/base/nav-card-grid";

const ASSISTANT_PATH = "/modules/ai";
const ASSISTANT_COLUMNS = 3;

const ASSISTANT_PAGES = [
  {
    id: "overview",
    title: "$dms_ai.pages.overview.title",
    description: "$dms_ai.pages.overview.description",
    icon: "i-ph-chart-line",
  },
  {
    id: "changes",
    title: "$dms_ai.pages.changes.title",
    description: "$dms_ai.pages.changes.description",
    icon: "i-ph-git-diff",
  },
  {
    id: "activity",
    title: "$dms_ai.pages.activity.title",
    description: "$dms_ai.pages.activity.description",
    icon: "i-ph-clock-counter-clockwise",
  },
  {
    id: "skills",
    title: "$dms_ai.pages.skills.title",
    description: "$dms_ai.pages.skills.description",
    icon: "i-ph-books",
  },
  {
    id: "settings",
    title: "$dms_ai.pages.settings.title",
    description: "$dms_ai.pages.settings.description",
    icon: "i-ph-gear-six",
  },
];

@RegisterPage()
export class HomePage extends PageController("home", {
  displayName: "Home",
  icon: "i-ph-house",
  category: pagesCategory,
  order: 0,
  description: "Playground home page",
}) {
  static assistant = NavCardGrid({
    title: "$dms_ai.module.title",
    description: "$dms_ai.module.description",
    columns: ASSISTANT_COLUMNS,
    items: ASSISTANT_PAGES.map((page) => ({
      ...page,
      iconTone: "secondary",
      to: `${ASSISTANT_PATH}/${page.id}`,
    })),
  }).meta({
    name: "$dms_ai.module.title",
    description: "$dms_ai.module.description",
    icon: "i-ph-sparkle",
  });

  static contactForm = Form({
    title: "Contact Us",
    description: "Send us a message and we will get back to you",
    fields: [
      {
        id: "name",
        label: "Name",
        type: new DefaultDataTypes.StringType({
          placeholder: "Your name",
          maxLength: 100,
        }),
        required: true,
      },
      {
        id: "email",
        label: "Email",
        type: new DefaultDataTypes.EmailType({
          placeholder: "you@example.com",
        }),
        required: true,
      },
      {
        id: "message",
        label: "Message",
        type: new DefaultDataTypes.StringType({
          placeholder: "Write your message...",
          textarea: true,
          rows: 5,
          maxLength: 1000,
        }),
        required: true,
      },
    ],
  });
}
