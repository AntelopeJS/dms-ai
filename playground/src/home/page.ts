import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Form } from "@antelopejs/interface-dms/base/form-schema";

@RegisterPage()
export class HomePage extends PageController("home", {
  displayName: "Home",
  icon: "i-ph-house",
  category: pagesCategory,
  order: 0,
  description: "Playground home page",
}) {
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
