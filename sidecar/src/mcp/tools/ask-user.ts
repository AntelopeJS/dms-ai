import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { QuestionRequest } from "../../agent/question-bus.js";
import {
  ASK_USER_RESULT_NO_ANSWER,
  ASK_USER_RESULT_PREFIX,
  ASK_USER_TOOL_DESCRIPTION,
  ASK_USER_TOOL_NAME,
} from "../../constants/mcp.js";
import { QuestionSchema, type QuestionType } from "../../protocol/events.js";

export interface AskUserDeps {
  conversationId: string;
  requestQuestion: (req: QuestionRequest) => Promise<string[] | null>;
}

const INPUT_SCHEMA = {
  questions: z.array(QuestionSchema).min(1).max(4),
} as const;

function buildResultText(
  questions: QuestionType[],
  answers: string[] | null,
): string {
  if (answers === null) return ASK_USER_RESULT_NO_ANSWER;
  const lines = questions.map((q, i) => {
    const answer = answers[i] ?? "(no answer)";
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
  return tool(
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
