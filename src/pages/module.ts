import { RegisterModule } from "@antelopejs/interface-dms/page";
import { I18N_SECTIONS } from "../constants/i18n";
import { MODULE_ID } from "../constants/module";
import { AI_MODULE_ICON, AI_MODULE_LANDING_PAGE } from "../constants/pages";
import { i18nKey } from "../vocabulary";

RegisterModule({
  id: MODULE_ID,
  title: i18nKey(I18N_SECTIONS.MODULE, "title"),
  description: i18nKey(I18N_SECTIONS.MODULE, "description"),
  icon: AI_MODULE_ICON,
  landingPage: AI_MODULE_LANDING_PAGE,
});
