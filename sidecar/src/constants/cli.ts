// Only reached when the sidecar is launched by hand, outside the dms-ai
// module: the module passes `--backend-url` whenever its `backendUrl` config
// key is set, and leaving it unset is what keeps a project that never
// configured it on this value.
export const STANDALONE_BACKEND_BASE_URL = "http://localhost:5010";
