import { Form } from "@antelopejs/interface-dms/base";
import {
  PageController,
  pagesCategory,
  RegisterPage,
} from "@antelopejs/interface-dms/page";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

/** A project page that is not a module page, so the chat offers its generic starters. */
@RegisterPage()
export class PlainPage extends PageController("verify-plain", {
  displayName: "Verify plain",
  category: pagesCategory,
  order: 5,
}) {
  static content = Form({
    title: "Plain",
    fields: [
      {
        id: "note",
        label: "Note",
        type: new DefaultDataTypes.StringType({ maxLength: 100 }),
        required: false,
      },
    ],
  });
}

/** The playground's home page, where the dashboard opens. */
@RegisterPage()
export class HomePage extends PageController("home", {
  displayName: "Home",
  category: pagesCategory,
  order: 0,
}) {
  static content = Form({
    title: "Home",
    fields: [
      {
        id: "name",
        label: "Name",
        type: new DefaultDataTypes.StringType({ maxLength: 100 }),
        required: false,
      },
    ],
  });
}
