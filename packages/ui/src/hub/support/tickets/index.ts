// @cds/ui/hub/support/tickets (12-10): the Tickets tab list, Get help form parts (type cards,
// target picker, help deflection) and the ticket detail rail and closed panel. Types from
// @cds/core/support, never @cds/db.
export {
  NEW_TICKET_HREF,
  TICKETS_COPY,
  canMarkSolved,
  followUpHref,
  targetValue,
  ticketHref,
  ticketStatusTone,
  ticketTypeShort,
} from "./copy";
export {
  TicketList,
  filterTickets,
  ticketSubline,
  type TicketListProps,
  type TicketListShow,
} from "./TicketList";
export {
  TicketTypeCards,
  ticketTypeOptions,
  type TicketTypeCardsProps,
} from "./TicketTypeCards";
export { TargetSelect, type TargetSelectProps } from "./TargetSelect";
export {
  DEFLECT_MAX,
  DEFLECT_MIN_CHARS,
  HelpDeflect,
  filterHelpDeflect,
  type HelpDeflectArticle,
  type HelpDeflectProps,
} from "./HelpDeflect";
export { TicketMeta, type TicketMetaProps } from "./TicketMeta";
export {
  ClosedTicketPanel,
  type ClosedTicketPanelProps,
} from "./ClosedTicketPanel";
