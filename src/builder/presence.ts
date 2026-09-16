import { ListModules } from "@antelopejs/interface-core/modules";
import {
  BUILDER_MODULE_ID,
  BUILDER_PRESENCE_TIMEOUT_MS,
} from "../constants/builder";

function withTimeout<T>(work: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(
      () => resolve(fallback),
      BUILDER_PRESENCE_TIMEOUT_MS,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export async function isBuilderAvailable(): Promise<boolean> {
  const ids = await withTimeout(ListModules(), [] as string[]);
  return ids.some(
    (id) => id === BUILDER_MODULE_ID || id.includes(BUILDER_MODULE_ID),
  );
}
