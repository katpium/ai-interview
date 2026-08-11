export type InterviewQuestion = {
  id: number;
  text: string;
  /**
   * Normal questions just get transcribed and the candidate moves on.
   * The "candidate_question" kind is the final stage where the candidate
   * asks a question — eventually answered by an LLM, but currently a
   * placeholder response is shown.
   */
  kind: "interview" | "candidate_question";
};

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = [
  {
    id: 1,
    text: "Tell me about yourself and why you are interested in this role.",
    kind: "interview",
  },
  {
    id: 2,
    text: "Describe a project where you solved a difficult technical problem.",
    kind: "interview",
  },
  {
    id: 3,
    text: "Tell me about a time you worked with a team under pressure.",
    kind: "interview",
  },
  {
    id: 4,
    text: "How do you approach learning a new technology?",
    kind: "interview",
  },
  {
    id: 5,
    text: "Why do you think you would be a good fit for this company?",
    kind: "interview",
  },
  {
    id: 6,
    text: "Do you have any questions for us?",
    kind: "candidate_question",
  },
];

export const CANDIDATE_QUESTION_PLACEHOLDER_RESPONSE =
  "Thank you for your question. In the next version, the AI will answer this using company-provided information.";
