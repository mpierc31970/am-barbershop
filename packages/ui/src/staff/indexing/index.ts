// @cds/ui/staff/indexing: search indexing table (13-39; STAFF-17, D190). Names are unique
// across the staff sub-barrels.
export { INDEXING_COPY, formatIndexingDay, formatIndexingTime } from "./copy";
export {
  IndexingTable,
  indexingLiveCount,
  indexingPingText,
  type IndexingPingWord,
  type IndexingResubmit,
  type IndexingResubmitAll,
  type IndexingRowView,
  type IndexingSitemapWord,
  type IndexingTableProps,
} from "./IndexingTable";
