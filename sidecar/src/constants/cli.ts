// Only reached when the sidecar is launched by hand, outside the dms-ai
// module: the module passes `--backend-url` and `--host-origin` whenever its
// `backendUrl` / `hostOrigin` config keys are set, and leaving them unset is
// what keeps a project that never configured them on these values.
export const STANDALONE_BACKEND_BASE_URL = "http://localhost:5010";
export const STANDALONE_HOST_ORIGIN = "http://localhost:3001";
