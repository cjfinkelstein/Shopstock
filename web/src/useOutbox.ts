import { useEffect, useState } from "react";

import { type OutboxEntry, getQueue, subscribe } from "./outbox";

export function useOutbox(): OutboxEntry[] {
  const [queue, setQueue] = useState<OutboxEntry[]>(() => getQueue());
  useEffect(() => subscribe(() => setQueue(getQueue())), []);
  return queue;
}
