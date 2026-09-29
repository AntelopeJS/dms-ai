export interface PermissionRequestData {
	requestId: string;
	conversationId: string;
	toolName: string;
	args: unknown;
	summary: string;
}
