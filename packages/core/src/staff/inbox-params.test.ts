// 13-28 Task 1: inbox URL params (STAFF-05, STAFF-20; T-13-28-02).
import { describe, expect, it } from "vitest";
import {
  INBOX_PAGE_SIZE,
  QUICK_FILTERS,
  hasInboxFilters,
  inboxPage,
  inboxParamsToSearch,
  parseInboxParams,
  refineInboxRows,
  toStaffListInput,
  type InboxParams,
  type InboxRowLike,
} from "./inbox-params";

const ME = "staffme00000001";
const OTHER = "staffother00001";

function row(over: Partial<InboxRowLike> & { number: number }): InboxRowLike {
  return {
    subject: "Menu photo",
    status: "open",
    priority: "normal",
    assigneeId: null,
    ageMs: 1000,
    sla: "on_track",
    ...over,
  };
}

describe("parseInboxParams", () => {
  it("parses the plan example and maps #1042 to a number search", () => {
    const p = parseInboxParams(
      new URLSearchParams("type=problem&status=open&quick=at-risk&q=%231042"),
    );
    expect(p).toEqual({
      type: "problem",
      status: "open",
      quick: "at-risk",
      q: "#1042",
    });
    const q = toStaffListInput(p, ME);
    expect(q.number).toBe(1042);
    expect(q.subject).toBeUndefined();
    expect(q.list).toEqual({ type: "problem", status: "all", sla: "at-risk" });
  });

  it("1042 without # is a number too", () => {
    expect(toStaffListInput(parseInboxParams({ q: "1042" }), ME).number).toBe(
      1042,
    );
  });

  it("drops unknown and malformed values", () => {
    expect(
      parseInboxParams(
        new URLSearchParams(
          "type=bogus&status=deleted&priority=max&assignee=x'||1&org=short&quick=everything&sla=late&sort=name&page=0&q=%20%20",
        ),
      ),
    ).toEqual({});
  });

  it("accepts a Next searchParams record (arrays take the first value)", () => {
    expect(
      parseInboxParams({
        status: ["waiting_on_you", "open"],
        assignee: "none",
      }),
    ).toEqual({ status: "waiting_on_you", assignee: "none" });
  });

  it("caps search text and ignores the default sort and page 1", () => {
    const p = parseInboxParams({ q: "a".repeat(500), sort: "sla", page: "1" });
    expect(p.q).toHaveLength(200);
    expect(p.sort).toBeUndefined();
    expect(p.page).toBeUndefined();
  });

  it("round trips parse(serialize(p)) for every field", () => {
    const p: InboxParams = {
      type: "change",
      status: "all",
      priority: "urgent",
      assignee: OTHER,
      org: "abcdefghijklmno",
      quick: "waiting",
      sla: "missed",
      q: "logo & colours",
      sort: "age",
      page: 3,
    };
    const s = inboxParamsToSearch(p);
    expect(parseInboxParams(new URLSearchParams(s))).toEqual(p);
    expect(inboxParamsToSearch({})).toBe("");
    for (const quick of QUICK_FILTERS) {
      expect(
        parseInboxParams(new URLSearchParams(inboxParamsToSearch({ quick }))),
      ).toEqual({ quick });
    }
  });

  it("hasInboxFilters ignores sort and page", () => {
    expect(hasInboxFilters({ sort: "age", page: 2 })).toBe(false);
    expect(hasInboxFilters({ q: "x" })).toBe(true);
  });
});

describe("toStaffListInput", () => {
  it("quick=mine → assignee me", () => {
    expect(toStaffListInput({ quick: "mine" }, "u1").assigneeId).toBe("u1");
  });

  it("quick=unassigned → null; assignee=me / none / id", () => {
    expect(toStaffListInput({ quick: "unassigned" }, ME).assigneeId).toBeNull();
    expect(toStaffListInput({ assignee: "me" }, ME).assigneeId).toBe(ME);
    expect(toStaffListInput({ assignee: "none" }, ME).assigneeId).toBeNull();
    expect(toStaffListInput({ assignee: OTHER }, ME).assigneeId).toBe(OTHER);
    expect("assigneeId" in toStaffListInput({}, ME)).toBe(false);
  });

  it("a quick filter wins over the explicit one", () => {
    expect(
      toStaffListInput({ assignee: OTHER, quick: "mine" }, ME).assigneeId,
    ).toBe(ME);
  });

  it("quick=waiting keeps active tickets and refines to Open / In progress", () => {
    const q = toStaffListInput({ quick: "waiting", status: "all" }, ME);
    expect(q.waiting).toBe(true);
    expect(q.list.status).toBeUndefined();
  });

  it("subject search is case-insensitive contains", () => {
    const q = toStaffListInput({ q: "Logo" }, ME);
    expect(q.subject).toBe("logo");
    expect(q.number).toBeUndefined();
  });

  it("defaults: SLA sort, page 1, empty list input", () => {
    expect(toStaffListInput({}, ME)).toEqual({
      list: {},
      sort: "sla",
      page: 1,
    });
  });
});

describe("refineInboxRows", () => {
  const rows = [
    row({ number: 1001, sla: "on_track", priority: "low", ageMs: 9000 }),
    row({ number: 1002, sla: "missed", priority: "normal", ageMs: 100 }),
    row({ number: 1003, sla: "on_track", priority: "urgent", ageMs: 50 }),
    row({ number: 1004, sla: "due_soon", priority: "high", assigneeId: ME }),
    row({
      number: 1042,
      sla: "none",
      status: "waiting_on_you",
      subject: "New LOGO please",
      assigneeId: OTHER,
    }),
  ];

  it("default sort: SLA urgency, then priority, then age", () => {
    expect(
      refineInboxRows(rows, toStaffListInput({}, ME)).map((r) => r.number),
    ).toEqual([1002, 1004, 1003, 1001, 1042]);
  });

  it("priority and age sorts", () => {
    expect(
      refineInboxRows(rows, toStaffListInput({ sort: "priority" }, ME)).map(
        (r) => r.number,
      ),
    ).toEqual([1003, 1004, 1002, 1042, 1001]);
    expect(
      refineInboxRows(rows, toStaffListInput({ sort: "age" }, ME))[0]?.number,
    ).toBe(1001);
  });

  it("number, subject, assignee, priority and waiting refinements", () => {
    const pick = (p: InboxParams) =>
      refineInboxRows(rows, toStaffListInput(p, ME)).map((r) => r.number);
    expect(pick({ q: "#1042" })).toEqual([1042]);
    expect(pick({ q: "logo" })).toEqual([1042]);
    expect(pick({ quick: "mine" })).toEqual([1004]);
    expect(pick({ quick: "unassigned" })).toEqual([1002, 1003, 1001]);
    expect(pick({ priority: "urgent" })).toEqual([1003]);
    expect(pick({ quick: "waiting" })).not.toContain(1042);
  });

  it("inboxPage is cumulative 50 per page", () => {
    const many = Array.from({ length: 120 }, (_, i) => i);
    expect(inboxPage(many, 1)).toHaveLength(INBOX_PAGE_SIZE);
    expect(inboxPage(many, 2)).toHaveLength(100);
    expect(inboxPage(many, 0)).toHaveLength(50);
  });
});
