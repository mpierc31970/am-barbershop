// @cds/ui/hub/support/ideas (12-11): the Ideas list, the vote toggle and the similar-ideas
// panel for the Suggest a feature form. Types from @cds/core/support, never @cds/db.
export {
  VOTE_COPY,
  VOTE_DEBOUNCE_MS,
  VoteButton,
  type VoteButtonProps,
} from "./VoteButton";
export {
  IDEAS_COPY,
  IDEA_HIGHLIGHT_MS,
  IDEA_STATUSES,
  IdeaList,
  SUGGEST_IDEA_HREF,
  filterIdeas,
  ideaStatusTone,
  matchIdea,
  type IdeaListProps,
  type IdeaStatus,
} from "./IdeaList";
export {
  SIMILAR_DEBOUNCE_MS,
  SIMILAR_MAX,
  SIMILAR_MIN_CHARS,
  SimilarIdeas,
  findSimilarIdeas,
  type SimilarIdeasProps,
} from "./SimilarIdeas";
