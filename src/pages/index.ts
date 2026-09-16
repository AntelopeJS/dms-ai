// `./module` is imported first so RegisterModule("ai") fires before any
// @RegisterPage decorator in `./all` runs — pages look the module up
// synchronously when their decorator is invoked at import time.
import "./module";
import "./all";

export * from "./all";
export * from "./module";
