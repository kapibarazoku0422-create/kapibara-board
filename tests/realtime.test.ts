import { describe, expect, it } from 'vitest';
import { directMessageChannel, publish, subscribe, threadChannel } from '../src/realtime.js';

describe('realtime channels', () => {
  it('delivers updates and unsubscribes cleanly', () => {
    const received: unknown[] = [];
    const stop = subscribe(threadChannel('topic-1'), (payload) => received.push(payload));
    publish(threadChannel('topic-1'), { body: 'hello' });
    stop();
    publish(threadChannel('topic-1'), { body: 'ignored' });
    expect(received).toEqual([{ body: 'hello' }]);
  });

  it('uses the same DM channel in both directions', () => {
    expect(directMessageChannel('user-a', 'user-b')).toBe(directMessageChannel('user-b', 'user-a'));
  });
});
