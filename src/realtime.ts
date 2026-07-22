import { EventEmitter } from 'node:events';

type Listener = (payload: unknown) => void;

const events = new EventEmitter();
events.setMaxListeners(0);

export function publish(channel: string, payload: unknown) {
  events.emit(channel, payload);
}

export function subscribe(channel: string, listener: Listener) {
  events.on(channel, listener);
  return () => events.off(channel, listener);
}

export function threadChannel(threadId: string) {
  return `thread:${threadId}`;
}

export function directMessageChannel(firstUserId: string, secondUserId: string) {
  return `dm:${[firstUserId, secondUserId].sort().join(':')}`;
}

export function groupChannel(groupId: string) {
  return `group:${groupId}`;
}
