/**
 * Which surface a chat is rendered on.
 *
 * "page" is the full-width route at `/`; "rail" is the project IDE's 26rem
 * side panel, which needs tighter type and its composer pinned to the bottom.
 *
 * A prop threaded from ChatWindow rather than context: layout is not session
 * state, and ChatSessionProvider's nesting (see its header comment) is about
 * scope resolution only. A prop also makes "the `/` route is untouched"
 * something the type checker can see.
 */
export type ChatVariant = "page" | "rail";
