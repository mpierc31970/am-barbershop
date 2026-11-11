// P11 alerts/push fake (11-20): records every push instead of sending it. The default sender
// until the Web Push adapter lands (11-22), and the test double after that.
import type {
  PushOutcome,
  PushPayload,
  PushSender,
  PushSubscriptionKeys,
} from "./port";

export type RecordedPush = {
  endpoint: string;
  payload: PushPayload;
  outcome: PushOutcome;
};

export type FakePushSender = PushSender & {
  sent: RecordedPush[];
  /** Endpoints that answer "gone" or "error" instead of "ok". */
  fail: Map<string, Exclude<PushOutcome, "ok">>;
};

export function createFakePushSender(): FakePushSender {
  const sent: RecordedPush[] = [];
  const fail = new Map<string, Exclude<PushOutcome, "ok">>();
  return {
    sent,
    fail,
    send(sub: PushSubscriptionKeys, payload: PushPayload) {
      const outcome: PushOutcome = fail.get(sub.endpoint) ?? "ok";
      sent.push({
        endpoint: sub.endpoint,
        payload: structuredClone(payload),
        outcome,
      });
      return Promise.resolve(outcome);
    },
  };
}
