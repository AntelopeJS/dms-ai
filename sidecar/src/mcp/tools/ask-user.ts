import { z } from "zod";
import type {
  QuestionAnswers,
  QuestionRequest,
} from "../../agent/question-bus.js";
import {
  ASK_USER_RESULT_NO_ANSWER,
  ASK_USER_RESULT_PREFIX,
  ASK_USER_RESULT_SKIPPED,
  ASK_USER_TOOL_DESCRIPTION,
  ASK_USER_TOOL_NAME,
} from "../../constants/mcp.js";
import { QuestionSchema, type QuestionType } from "../../protocol/events.js";
import { defineTool } from "../define-tool.js";

export interface AskUserDeps {
  conversationId: string;
  requestQuestion: (req: QuestionRequest) => Promise<QuestionAnswers>;
}

const INPUT_SCHEMA = {
  questions: z.array(QuestionSchema).min(1).max(4),
} as const;

const NO_ANSWER_PLACEHOLDER = "(no answer)";

function buildResultText(
  questions: QuestionType[],
  reply: QuestionAnswers,
): string {
  if (reply === null) return ASK_USER_RESULT_NO_ANSWER;
  const lines = questions.map((q, i) => {
    if (reply.skipped[i] === true)
      return `- ${q.header}: ${ASK_USER_RESULT_SKIPPED}`;
    const answer = reply.answers[i] ?? NO_ANSWER_PLACEHOLDER;
    return `- ${q.header}: ${answer}`;
  });
  return `${ASK_USER_RESULT_PREFIX}\n${lines.join("\n")}`;
}

function buildContent(text: string): {
  content: Array<{ type: "text"; text: string }>;
} {
  return { content: [{ type: "text", text }] };
}

export function buildAskUserTool(deps: AskUserDeps) {
  return defineTool(
    ASK_USER_TOOL_NAME,
    ASK_USER_TOOL_DESCRIPTION,
    INPUT_SCHEMA,
    async ({ questions }: { questions: QuestionType[] }) => {
      const answers = await deps.requestQuestion({
        conversationId: deps.conversationId,
        questions,
      });
      return buildContent(buildResultText(questions, answers));
    },
  );
}
