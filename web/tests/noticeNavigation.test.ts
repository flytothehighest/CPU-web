import assert from 'node:assert/strict';
import test from 'node:test';
import { navigateNoticeTarget } from '../src/utils/noticeNavigation';

test('song advice notifications perform a full navigation and preserve the confirmation song ID', () => {
  const calls: string[] = [];
  const navigation = { assign: (url: string) => calls.push(`document:${url}`), push: (url: string) => calls.push(`spa:${url}`) };
  for (const url of ['/voicehub/?reviewSong=1285', '/voicehub/', '/voicehub?reviewSong=1', '/voicehub/dashboard']) {
    navigateNoticeTarget(url, navigation);
    assert.equal(calls.at(-1), `document:${url}`);
  }
  for (const url of ['/forum/t/123', '/messages', '/services/tools/voicehub', '/voicehub-other']) {
    navigateNoticeTarget(url, navigation);
    assert.equal(calls.at(-1), `spa:${url}`);
  }
});
